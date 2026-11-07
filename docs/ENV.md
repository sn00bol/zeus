# Environment variables

ZEUS reads configuration from a `.env` file in the repository root. Start by
copying `.env.example` to `.env`, then fill in the values for the platforms and
model provider you use. Keep `.env` private; it contains database passwords,
bot tokens, and potentially model API keys.

```text
cp .env.example .env
```

For Docker Compose, the `.env` file is also used to substitute Compose values.
In particular, `DB_PASSWORD` must be set before Compose can start PostgreSQL.

## Platform and model

| Variable | Default | Description |
| --- | --- | --- |
| `PLATFORM` | `webui` | Enables the WebUI and optionally Discord, Telegram, or both: `webui`, `webui,discord`, `webui,telegram`, or `webui,discord,telegram`. |
| `ZEUS_PROVIDER` | unset | Preferred provider: `ollama`, `lmstudio`, or `llamacpp`. If unset, ZEUS selects a reachable provider. |
| `ZEUS_MODEL` | unset | Preferred model ID. Leave empty to use the first model discovered by the selected provider. The WebUI can also select a model per conversation. |
| `LLM_HOST` | provider-dependent | Hostname or IP address of the model server when running ZEUS directly on the host. |
| `LLM_PORT` | provider-dependent | Port of the model server. If empty, the provider default is used. |
| `ZEUS_LLM_HOST` | `host.docker.internal` | Hostname Compose assigns to `LLM_HOST` for the ZEUS container. Change it when the model server is not running on the Docker host (for example, use the Compose service name for another container). |

Provider default ports:

| Provider | Default port |
| --- | ---: |
| Ollama | `11434` |
| LM Studio | `1234` |
| llama.cpp server | `8080` |

`LLM_HOST` and `LLM_PORT` configure only the provider named by `ZEUS_PROVIDER`.
Other providers use their provider-specific host and port variables (or their
defaults), so model discovery does not query the selected provider's endpoint
as if it belonged to every provider.

### Model API keys

| Variable | Description |
| --- | --- |
| `OLLAMA_API_KEY` / `OLLAMA_TOKEN` | Optional Ollama endpoint credential (e.g. for remote or authenticated Ollama servers). |

> Note: LM Studio and llama.cpp local providers do not require or support API keys, and generic model tokens are not required.

## WebUI

| Variable | Default | Description |
| --- | --- | --- |
| `WEBUI_HOST` | `127.0.0.1` | WebUI bind address when running directly on the host. Compose sets this to `0.0.0.0` inside its container so the published port is reachable. |
| `WEBUI_PORT` | `3000` | WebUI HTTP port. Compose publishes it on host loopback (`127.0.0.1`). |
| `WEBUI_BRIDGE_HOST` | `127.0.0.1` | Bind address for the private Python inference bridge used by the Node WebUI. |
| `WEBUI_BRIDGE_PORT` | `5002` | Port for the private WebUI inference bridge. Keep it different from `WEBUI_PORT`. |
| `WEBUI_BRIDGE_URL` | unset | Optional URL for an independently managed WebUI inference bridge. When set, ZEUS does not start a bridge subprocess and requires this endpoint to be available. |

The WebUI bridge is separate from the platform bridge used by Discord and
Telegram.

Conversation titles are generated after the first response has completed, so
title inference does not delay the chat response. ZEUS uses the same provider
and model that produced the chat response, whether selected by the user or
automatically by ZEUS. The sidebar shows an animated title placeholder while
generation is pending and refreshes automatically. User-renamed titles are
never replaced. If generation fails, ZEUS uses the default title.
The title, its `title_status` (`pending`, `generated`, or `failed`), and its
`title_source` (`default`, `ai`, or `user`) are stored in the conversation's
existing `chat_sessions.metadata` JSONB field.

## SearXNG

| Variable | Default | Description |
| --- | --- | --- |
| `SEARXNG_VERSION` | `latest` | Docker image tag used by Compose for SearXNG. Pin a release tag for reproducible deployments. |
| `SEARXNG_URL` | `http://searxng:8080` in Compose | SearXNG URL used by ZEUS for search and to check service availability in Settings → Information. |

## Database

| Variable | Default | Description |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | PostgreSQL host for direct, non-Compose runs. Compose sets this to `postgres` for the ZEUS container. |
| `DB_PORT` | `5432` | PostgreSQL port. In Compose this is the host-side published port; the ZEUS container connects to PostgreSQL on its internal port `5432`. |
| `DB_NAME` | `zeus` | Database name. |
| `DB_USER` | `zeus` | Database user. |
| `DB_PASSWORD` | required | PostgreSQL password. Compose requires a non-empty value. Generate a long random value and do not commit it. |
| `DB_POOL_MAX_SIZE` | `10` | Maximum number of database connections in the Python database pool. |

To generate a suitable password with Python:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Discord and Telegram

| Variable | Description |
| --- | --- |
| `DISCORD_BOT_API_KEY` | Discord bot token. Required when `PLATFORM` includes `discord`. |
| `PFX` | Discord message-command prefix. Required when running the Discord bot. |
| `OWNER_ID` | Optional comma-separated Discord user IDs allowed to use owner-only restart/stop commands. |
| `TELEGRAM_BOT_API_KEY` | Telegram bot token. Required when `PLATFORM` includes `telegram`. |
| `SLASH_GUILD_ID` | Optional Discord server ID for faster guild-scoped slash-command registration. |
| `SLASH_RESET` | Set to `true` for a one-time reset of registered Discord slash commands. |
| `BRIDGE_HOST` | Bind address for the Discord/Telegram platform inference bridge. |
| `BRIDGE_PORT` | Port for the Discord/Telegram platform inference bridge; defaults to `5000`. |
| `BRIDGE_URL` | Node bot URL for that platform bridge; defaults to `http://127.0.0.1:5000`. |
| `BRIDGE_TOKEN` | Required private bearer token shared by the Node bot and Python platform bridge. `setup.py` generates it. |
| `HEALTHCHECK_HOST` | Healthcheck bind/target host. Defaults to `127.0.0.1`. |
| `HEALTHCHECK_PORT` | Bot health endpoint port when a bot is enabled; defaults to `3001` under the Python supervisor. |

The platform bridge requires `Authorization: Bearer <BRIDGE_TOKEN>` for every
endpoint except `/health`. This protects control, session, and inference APIs
even when the bridge is accessed through a proxy or exposed beyond loopback.
Use a long random token and keep it private. Requests larger than 16 MiB are
rejected. This is service-level authorization: any holder of the shared token
can access any platform session through the bridge; end-user ownership checks
are enforced by the calling application, not by a per-user bridge identity.

## Compose image settings

| Variable | Description |
| --- | --- |
| `ZEUS_IMAGE` | Image name/tag for the ZEUS service. Defaults to `zeus:local`. |

The example environment file also includes `ZEUS_PULL_POLICY`,
`ZEUS_WATCHTOWER_ENABLED`, `ZEUS_UID`, `ZEUS_GID`, `ZEUS_MEMORY_LIMIT`, and
`ZEUS_CPUS`. The current `compose.yaml` does not use these values; setting them
does not change the container's pull policy, user, resource limits, or update
behavior.
