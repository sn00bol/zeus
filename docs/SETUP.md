# Setup

ZEUS runs a Node.js WebUI, a Python inference bridge, and PostgreSQL. Docker
Compose starts the WebUI and database together. You do not need to run
`python app.py` separately when using Compose.

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
   - Choose `ZEUS_PROVIDER` and optionally `ZEUS_MODEL`.
   - Set `ZEUS_LLM_HOST` to the address reachable **from the container**. For a
     provider running on the same machine, the default
     `host.docker.internal` is normally appropriate. For a provider in another
     Compose service or on another machine, use that service name or reachable
     hostname instead.
   - Leave `PLATFORM=webui` for WebUI-only. For a bot, use
     `PLATFORM=webui,discord` or `PLATFORM=webui,telegram` and fill in its token.
     Discord also requires `PFX`.

   To generate a random password with Python:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

4. Build and start ZEUS:

   ```bash
   docker compose up --build -d
   ```

5. Open `http://localhost:3000`. If you changed `WEBUI_PORT`, open that port
   instead.

Compose publishes the WebUI on the host's loopback interface, starts
PostgreSQL before ZEUS, and waits for PostgreSQL's healthcheck. The WebUI
inference bridge is started by the Node WebUI process inside the ZEUS
container.

## Check startup and logs

```bash
docker compose ps
docker compose logs -f zeus
docker compose logs -f postgres
```

The ZEUS container healthcheck tests the WebUI endpoint. To stop the services:

```bash
docker compose down
```

PostgreSQL data is stored in `database/postgres` and remains when containers
are stopped or removed. Back up this directory before deleting or replacing
database data.

## Updating

Pull the latest source, then rebuild and recreate the containers:

```bash
git pull
docker compose up --build -d
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
   python -m pip install -r requirements.txt
   ```

4. Start the application:

   ```bash
   python app.py
   ```

The supervisor starts the WebUI and its private inference bridge. If Discord
or Telegram is selected, it starts that bot and its platform bridge as well.
