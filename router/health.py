"""
router/health — Automated health monitoring and in-memory fallback management.

Continuously monitors child services:
- PostgreSQL database (with automatic fallback to in-memory store)
- AI providers (Ollama, LM Studio, llama.cpp)
- Platform bridges (Discord bot, WebUI bridge)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from core.database import DatabaseRouter
from core.model import ModelManager
from router.broker import EventBroker, get_event_broker

log = logging.getLogger(__name__)


@dataclass
class ServiceStatus:
    name: str
    status: str       # "online" | "degraded" | "offline"
    latency_ms: float | None = None
    details: dict[str, Any] = field(default_factory=dict)
    last_checked: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "latency_ms": round(self.latency_ms, 2) if self.latency_ms is not None else None,
            "details": self.details,
            "last_checked": self.last_checked,
        }


class HealthMonitor:
    """
    Monitors child services and manages automated in-memory database fallback.
    """

    def __init__(
        self,
        database: DatabaseRouter | None = None,
        model_manager: ModelManager | None = None,
        broker: EventBroker | None = None,
    ) -> None:
        self.database = database
        self.model_manager = model_manager
        self.broker = broker or get_event_broker()

        self._services: dict[str, ServiceStatus] = {}
        self._monitor_task: asyncio.Task[None] | None = None
        self._last_overall_status = "unknown"
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Individual Service Checks
    # ------------------------------------------------------------------

    async def check_database(self) -> ServiceStatus:
        """Check PostgreSQL connectivity; trigger in-memory fallback on failure."""
        if self.database is None:
            return ServiceStatus(
                name="postgres",
                status="offline",
                details={"message": "No database router configured."},
            )

        if self.database.is_fallback:
            return ServiceStatus(
                name="postgres",
                status="degraded",
                details={"mode": "in-memory-fallback", "message": "Operating on in-memory store."},
            )

        start = time.perf_counter()
        try:
            # Quick query to test pool
            await asyncio.wait_for(self.database.fetchrow("SELECT 1"), timeout=3.0)
            latency = (time.perf_counter() - start) * 1000.0
            return ServiceStatus(
                name="postgres",
                status="online",
                latency_ms=latency,
                details={
                    "host": os.environ.get("DB_HOST", "127.0.0.1"),
                    "port": os.environ.get("DB_PORT", "5432"),
                },
            )
        except Exception as exc:
            log.warning("Database health check failed: %s. Activating in-memory fallback.", exc)
            self.database.enable_fallback()
            await self.broker.publish(
                "health.database_fallback_activated",
                {"error": str(exc), "timestamp": time.time()},
            )
            return ServiceStatus(
                name="postgres",
                status="degraded",
                details={"mode": "in-memory-fallback", "reason": str(exc)},
            )

    async def check_providers(self) -> dict[str, ServiceStatus]:
        """Check online reachability of supported AI providers."""
        statuses: dict[str, ServiceStatus] = {}
        providers = ("ollama", "lmstudio", "llamacpp")

        for name in providers:
            start = time.perf_counter()
            try:
                if self.model_manager is not None:
                    provider = self.model_manager.get_provider(name)
                    is_online = await asyncio.wait_for(provider.ping(), timeout=3.0)
                else:
                    is_online = False

                latency = (time.perf_counter() - start) * 1000.0 if is_online else None
                status = "online" if is_online else "offline"
                statuses[name] = ServiceStatus(
                    name=name,
                    status=status,
                    latency_ms=latency,
                    details={"provider": name},
                )
            except Exception as exc:
                statuses[name] = ServiceStatus(
                    name=name,
                    status="offline",
                    details={"error": str(exc)},
                )

        return statuses

    async def check_platforms(self) -> dict[str, ServiceStatus]:
        """Check status of Discord/WebUI bridges."""
        statuses: dict[str, ServiceStatus] = {}

        if httpx is None:
            return statuses

        bridges = {
            "discord_bridge": int(os.environ.get("BRIDGE_PORT", "5000")),
            "webui_bridge": int(os.environ.get("WEBUI_BRIDGE_PORT", "5002")),
        }

        async with httpx.AsyncClient(timeout=1.5) as client:
            for name, port in bridges.items():
                start = time.perf_counter()
                try:
                    resp = await client.get(f"http://127.0.0.1:{port}/health")
                    latency = (time.perf_counter() - start) * 1000.0
                    status = "online" if resp.status_code == 200 else "degraded"
                    statuses[name] = ServiceStatus(
                        name=name,
                        status=status,
                        latency_ms=latency,
                        details={"port": port, "status_code": resp.status_code},
                    )
                except Exception:
                    statuses[name] = ServiceStatus(
                        name=name,
                        status="offline",
                        details={"port": port},
                    )

        return statuses

    # ------------------------------------------------------------------
    # Comprehensive Check & Status Aggregation
    # ------------------------------------------------------------------

    async def check_all(self) -> dict[str, Any]:
        """Run all health checks concurrently and aggregate system status."""
        async with self._lock:
            db_task = self.check_database()
            providers_task = self.check_providers()
            platforms_task = self.check_platforms()

            db_status, provider_statuses, platform_statuses = await asyncio.gather(
                db_task, providers_task, platforms_task, return_exceptions=False
            )

            self._services["postgres"] = db_status
            for k, v in provider_statuses.items():
                self._services[f"provider:{k}"] = v
            for k, v in platform_statuses.items():
                self._services[f"platform:{k}"] = v

            # Compute overall status
            overall = "healthy"
            if db_status.status == "degraded":
                overall = "degraded"
            elif db_status.status == "offline":
                overall = "unhealthy"

            online_providers = sum(1 for s in provider_statuses.values() if s.status == "online")
            if online_providers == 0:
                overall = "unhealthy"
            elif online_providers < len(provider_statuses) and overall == "healthy":
                overall = "degraded"

            payload = {
                "overall_status": overall,
                "timestamp": time.time(),
                "database": db_status.to_dict(),
                "providers": {k: v.to_dict() for k, v in provider_statuses.items()},
                "platforms": {k: v.to_dict() for k, v in platform_statuses.items()},
            }

            if overall != self._last_overall_status:
                self._last_overall_status = overall
                await self.broker.publish("health.status_changed", payload)

            return payload

    # ------------------------------------------------------------------
    # Background Monitor Loop
    # ------------------------------------------------------------------

    async def start(self, interval_seconds: float = 30.0) -> None:
        """Start the background periodic health check loop."""
        if self._monitor_task is None:
            self._monitor_task = asyncio.create_task(
                self._loop(interval_seconds),
                name="zeus-health-monitor",
            )

    async def stop(self) -> None:
        """Stop the background periodic health check loop."""
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
            self._monitor_task = None

    async def _loop(self, interval: float) -> None:
        while True:
            try:
                await self.check_all()
            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Unexpected error in health monitor loop")
            await asyncio.sleep(interval)


_default_health_monitor: HealthMonitor | None = None


def get_health_monitor(
    database: DatabaseRouter | None = None,
    model_manager: ModelManager | None = None,
) -> HealthMonitor:
    """Return the global shared HealthMonitor instance."""
    global _default_health_monitor
    if _default_health_monitor is None:
        _default_health_monitor = HealthMonitor(database=database, model_manager=model_manager)
    return _default_health_monitor
