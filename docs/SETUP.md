# Setup

ZEUS runs a Node.js WebUI, a Python inference bridge, and PostgreSQL. SearXNG
runs in its own container in the same Docker Compose project. You do not need
to run `python app.py` separately when using Compose.

## Requirements

- A running supported model server: Ollama, LM Studio, or llama.cpp.
- A Discord or Telegram bot token only if you want to run that bot alongside
  the WebUI.
- Docker Engine with Docker Compose, or Docker Desktop (for the recommended setup)
- Node.js 16.11+ and Python 3.13+ (only when running outside Docker)
- Optional Discord or Telegram bot token
- A Discord or Telegram bot token only if you want to run that bot alongside
  the WebUI.

## First-time Docker setup

1. Clone the repository and enter its directory:

   ```bash
   git clone https://github.com/sn00bol/zeus.git
   cd zeus
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env`:
   - Set `DB_PASSWORD` to a long, random password. Compose will refuse to start
     PostgreSQL if it is empty.
   - Set `SEARXNG_SECRET` to a long, random value. `python setup.py` generates
     this secret along with the database password and bridge token.
   - `SEARXNG_URL` defaults to `http://searxng:8080` for ZEUS-to-SearXNG
     container traffic. If you are upgrading an existing `.env` from the
     previous separate Compose setup, change its old `host.docker.internal`
     URL to `http://searxng:8080`. Set `SEARXNG_URL` to a different address
     only when using a different SearXNG instance. `SEARXNG_PORT` defaults to
     `8888` for opening SearXNG from the host; change it only to use a
     different host port.
   - Choose `ZEUS_PROVIDER` and optionally `ZEUS_MODEL`.
   - Set `ZEUS_LLM_HOST` to the address reachable **from the container**. For a
     provider running on the same machine, the default
     `host.docker.internal` is normally appropriate. For a provider in another
     Compose service or on another machine, use that service name or reachable
     hostname instead.
   - Leave `PLATFORM=webui` for WebUI-only. For a bot, use
     `PLATFORM=webui,discord` or `PLATFORM=webui,telegram`; to run both use
     `PLATFORM=webui,discord,telegram`. Fill in the token for each selected bot.
     Discord also requires `PFX`.
   - Set `BRIDGE_TOKEN` to a long random value for the private Discord/Telegram
     bridge. Running `python setup.py` generates and saves it automatically.

   To generate a random password with Python:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

4. Build and start the stack:

   ```bash
   docker compose up --build -d
   ```

   If upgrading from the previous separate SearXNG Compose setup, stop its
   existing container first so it releases port `8888`:

   ```bash
   docker ps --filter publish=8888
   docker stop <old-searxng-container>
   ```

   The old container is commonly named `searxng-searxng-1`. Only stop the
   SearXNG container shown by the first command, then retry `docker compose up`.

5. Open `http://localhost:3000`. If you changed `WEBUI_PORT`, open that port
   instead.

The root Compose project runs ZEUS, PostgreSQL, and SearXNG as separate
containers on its Compose network. SearXNG's normal HTML search page is
published on the host loopback at `http://localhost:8888` and is not exposed
to the local network. ZEUS reaches SearXNG over the internal Compose network
at `http://searxng:8080`. Its settings are in
[settings.yml](../searxng/settings.yml).
ZEUS analyzes WebUI messages with the selected model and searches when fresh
web evidence would help; no search keywords or `@` selection are required.
You can still type `@` and select **Search** to force a lookup. ZEUS fetches the
regular HTML search page, not SearXNG's JSON API or the source engines directly.
ZEUS uses its selected model to screen SearXNG results against the full user
request before adding them to the answer context. Only results that pass this
relevance check appear as compact source pills below the answer; if screening
fails, unrelated result links are withheld. SearXNG aggregates results from its
configured engines.

## Check startup and logs

```bash
docker compose ps
docker compose logs -f zeus
docker compose logs -f postgres
docker compose logs -f searxng
```

The ZEUS container healthcheck tests the WebUI endpoint. To stop the services:

```bash
docker compose down
```

To stop only SearXNG while leaving ZEUS and PostgreSQL running:

```bash
docker compose stop searxng
```

The ZEUS and SearXNG services are separate containers. `docker compose down`
stops and removes the containers for the whole stack; it does not remove the
SearXNG image or the SearXNG settings files.

PostgreSQL data is stored in `database/postgres` and remains when containers
are stopped or removed. Back up this directory before deleting or replacing
database data.

## Updating

Pull the latest source, then rebuild and recreate the containers:

```bash
git pull
docker compose up --build -d
```

SearXNG is updated independently from ZEUS while remaining part of the same
Compose project. To update its image, run:

```bash
docker compose pull searxng
docker compose up -d searxng
```

## Optional: configure interactively

`setup.py` can create/update `.env`, select a provider and platform, discover
available models, and install Python and Node dependencies on the host:

```bash
python setup.py
```

This is optional for Docker-only use. If setup is run, review the generated
`.env` and ensure `ZEUS_LLM_HOST` is appropriate for Docker before starting
Compose.

## Run without Docker

For development or a host-managed PostgreSQL server:

1. Install Node.js 16.11+ and Python 3.13+.
2. Create and configure `.env` as described in [ENV.md](./ENV.md), including
   database connection details and a reachable model server.
3. Install dependencies:

   ```bash
   npm ci
   python -m pip install .
   ```

4. Start the application:

   ```bash
   python app.py
   ```

The supervisor starts the WebUI and its private inference bridge. Discord and
Telegram can be selected together; the supervisor starts both bot processes
and shares their platform inference bridge.
