"""
router/security — Security manager for LAN monitoring, IP verification, and token encryption.

Provides:
- Private LAN & localhost IP verification.
- Cryptographic token encryption, decryption, and constant-time validation.
- LAN connection access control and request auditing.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# Standard private and loopback IPv4/IPv6 networks
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),       # Loopback
    ipaddress.ip_network("10.0.0.0/8"),        # Class A Private
    ipaddress.ip_network("172.16.0.0/12"),     # Class B Private
    ipaddress.ip_network("192.168.0.0/16"),    # Class C Private
    ipaddress.ip_network("169.254.0.0/16"),    # Link-local
    ipaddress.ip_network("::1/128"),           # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 Unique Local
    ipaddress.ip_network("fe80::/10"),         # IPv6 Link-local
]


def is_private_or_local_ip(ip: str) -> bool:
    """Return True if the IP string belongs to localhost or a private LAN subnet."""
    clean_ip = ip.strip()
    if clean_ip in {"localhost", "host.docker.internal"}:
        return True
    try:
        addr = ipaddress.ip_address(clean_ip)
        return any(addr in network for network in _PRIVATE_NETWORKS)
    except ValueError:
        return False


@dataclass
class AuditRecord:
    timestamp: float
    client_ip: str
    action: str
    authorized: bool
    reason: str


class SecurityManager:
    """
    Manages LAN security checks, token encryption, and access auditing.
    """

    def __init__(
        self,
        secret_key: str | None = None,
        allowed_subnets: list[str] | None = None,
        require_lan_auth: bool = False,
        api_token: str | None = None,
    ) -> None:
        raw_secret = (
            secret_key
            or os.environ.get("ZEUS_SECRET_KEY")
            or os.environ.get("DB_PASSWORD")
            or "zeus-default-secure-key"
        )
        self._secret_bytes = hashlib.sha256(raw_secret.encode("utf-8")).digest()
        self.require_lan_auth = require_lan_auth or os.environ.get("ZEUS_REQUIRE_LAN_AUTH", "").lower() == "true"
        self._api_token = api_token or os.environ.get("ZEUS_API_TOKEN")

        self._allowed_networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = list(_PRIVATE_NETWORKS)
        if allowed_subnets:
            for subnet in allowed_subnets:
                self.add_allowed_network(subnet)

        self._audit_log: list[AuditRecord] = []

    def add_allowed_network(self, network_str: str) -> None:
        """Add an IP address or CIDR network to the allowed list."""
        try:
            net = ipaddress.ip_network(network_str.strip(), strict=False)
            self._allowed_networks.append(net)
        except ValueError as exc:
            log.warning("Invalid allowed network '%s': %s", network_str, exc)

    # ------------------------------------------------------------------
    # Token operations
    # ------------------------------------------------------------------

    def generate_token(self, prefix: str = "zeus_") -> str:
        """Generate a cryptographically secure random token."""
        return f"{prefix}{secrets.token_urlsafe(32)}"

    def hash_token(self, token: str) -> str:
        """Compute the SHA-256 hex digest of a token."""
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def verify_token(self, provided_token: str, expected_token: str) -> bool:
        """Constant-time token verification to prevent timing attacks."""
        if not provided_token or not expected_token:
            return False
        return hmac.compare_digest(provided_token.strip(), expected_token.strip())

    def encrypt_token(self, token: str) -> str:
        """
        Encrypt a token using HMAC-authenticated keystream encryption.

        Zero external dependencies, safe for storing or transferring tokens.
        Format: enc.<salt_b64>.<iv_b64>.<ciphertext_b64>.<hmac_b64>
        """
        if not token:
            return ""

        salt = secrets.token_bytes(16)
        iv = secrets.token_bytes(16)
        token_bytes = token.encode("utf-8")

        # Derive subkey using HMAC
        derived_key = hmac.new(self._secret_bytes, salt, hashlib.sha256).digest()

        # Keystream generation using iterative SHA256 blocks
        keystream = bytearray()
        block_counter = 0
        while len(keystream) < len(token_bytes):
            block = hashlib.sha256(derived_key + iv + block_counter.to_bytes(4, "big")).digest()
            keystream.extend(block)
            block_counter += 1

        ciphertext = bytes(a ^ b for a, b in zip(token_bytes, keystream[:len(token_bytes)]))
        tag = hmac.new(derived_key, iv + ciphertext, hashlib.sha256).digest()

        parts = [
            "enc",
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(iv).decode("ascii"),
            base64.urlsafe_b64encode(ciphertext).decode("ascii"),
            base64.urlsafe_b64encode(tag).decode("ascii"),
        ]
        return ".".join(parts)

    def decrypt_token(self, cipher_string: str) -> str:
        """Decrypt an encrypted token string and verify its authenticity tag."""
        if not cipher_string or not cipher_string.startswith("enc."):
            raise ValueError("Invalid encrypted token format.")

        parts = cipher_string.split(".")
        if len(parts) != 5:
            raise ValueError("Malformed encrypted token payload.")

        try:
            salt = base64.urlsafe_b64decode(parts[1])
            iv = base64.urlsafe_b64decode(parts[2])
            ciphertext = base64.urlsafe_b64decode(parts[3])
            expected_tag = base64.urlsafe_b64decode(parts[4])
        except Exception as exc:
            raise ValueError("Could not decode base64 token parts.") from exc

        derived_key = hmac.new(self._secret_bytes, salt, hashlib.sha256).digest()
        actual_tag = hmac.new(derived_key, iv + ciphertext, hashlib.sha256).digest()

        if not hmac.compare_digest(actual_tag, expected_tag):
            raise ValueError("Token integrity check failed (corrupted or tampered).")

        keystream = bytearray()
        block_counter = 0
        while len(keystream) < len(ciphertext):
            block = hashlib.sha256(derived_key + iv + block_counter.to_bytes(4, "big")).digest()
            keystream.extend(block)
            block_counter += 1

        decrypted = bytes(a ^ b for a, b in zip(ciphertext, keystream[:len(ciphertext)]))
        return decrypted.decode("utf-8")

    # ------------------------------------------------------------------
    # LAN & Request validation
    # ------------------------------------------------------------------

    def verify_lan_request(
        self,
        client_ip: str,
        auth_header: str | None = None,
        action: str = "request",
    ) -> tuple[bool, str]:
        """
        Verify if a request from *client_ip* is authorized to access LAN endpoints.

        Returns (is_authorized, reason).
        """
        clean_ip = client_ip.strip()
        is_ip_allowed = False

        if clean_ip in {"localhost", "host.docker.internal"}:
            is_ip_allowed = True
        else:
            try:
                addr = ipaddress.ip_address(clean_ip)
                is_ip_allowed = any(addr in net for net in self._allowed_networks)
            except ValueError:
                is_ip_allowed = False

        if not is_ip_allowed:
            record = AuditRecord(
                timestamp=time.time(),
                client_ip=clean_ip,
                action=action,
                authorized=False,
                reason="IP not in permitted LAN subnets.",
            )
            self._record_audit(record)
            return False, "Forbidden: IP address not allowed in LAN environment."

        # Verify auth token if configured or required
        if self.require_lan_auth:
            if not self._api_token:
                # If required but no token configured, allow localhost only
                if clean_ip in {"127.0.0.1", "::1", "localhost"}:
                    return True, "Authorized (localhost exemption)."
                return False, "Forbidden: LAN authentication required but no token is configured."

            token_from_header = ""
            if auth_header:
                if auth_header.startswith("Bearer "):
                    token_from_header = auth_header[7:].strip()
                else:
                    token_from_header = auth_header.strip()

            if not self.verify_token(token_from_header, self._api_token):
                record = AuditRecord(
                    timestamp=time.time(),
                    client_ip=clean_ip,
                    action=action,
                    authorized=False,
                    reason="Invalid or missing bearer token.",
                )
                self._record_audit(record)
                return False, "Unauthorized: Invalid or missing API token."

        record = AuditRecord(
            timestamp=time.time(),
            client_ip=clean_ip,
            action=action,
            authorized=True,
            reason="Authorized LAN request.",
        )
        self._record_audit(record)
        return True, "Authorized."

    def _record_audit(self, record: AuditRecord) -> None:
        self._audit_log.append(record)
        if len(self._audit_log) > 200:
            self._audit_log.pop(0)

    def get_audit_log(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the recent audit history."""
        return [
            {
                "timestamp": r.timestamp,
                "client_ip": r.client_ip,
                "action": r.action,
                "authorized": r.authorized,
                "reason": r.reason,
            }
            for r in self._audit_log[-limit:]
        ]


_default_security_manager: SecurityManager | None = None


def get_security_manager() -> SecurityManager:
    """Return the global default SecurityManager instance."""
    global _default_security_manager
    if _default_security_manager is None:
        _default_security_manager = SecurityManager()
    return _default_security_manager
