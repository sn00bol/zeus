<p align="center">
  <img width="300" height="300" alt="Santaa Bot Logo" src="https://github.com/user-attachments/assets/1804bf80-6b57-4d55-8345-a3eb55386cb1" />
</p>

<div align="center">
<img width="150" height="150" alt="Basda Logo" src="assets/Basda.png" />
  <p>A self-hosting AI Agent for Discord, Telegram</p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#setup">Setup</a> ·
    <a href="CONTRIBUTING.md">Contributing</a> ·
  </p>
  <p>
    <a href="https://github.com/sn00bol/zeus/releases"><img src="https://img.shields.io/github/v/release/sn00bol/zeus?include_prereleases" alt="GitHub Release" /></a>
    <a href="https://github.com/sn00bol/zeus/actions"><img src="https://img.shields.io/github/actions/workflow/status/sn00bol/zeus/ci.yml" alt="Release Build Status" /></a>
    <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License" /></a>
  </p>
  <p>
    <a href="https://github.com/sn00bol/Basda/releases"><img src="https://raw.githubusercontent.com/NeoApplications/Neo-Backup/034b226cea5c1b30eb4f6a6f313e4dadcbb0ece4/badge_github.png" width="180" alt="Get it on GitHub" /></a>
  </p>
</div>

---

## Features
- Literrally a chatbot — You can ask anything all the earth, chatting like friends, explaining, do a basic math equations,...
- Analysis documents — Support writing, spelling error checks, suggestion and basic Text Editor
- Searching with searXNG - Support built in searXNG and Deep research, optimize result and speed
- Compare - Using Discord Components V2 for more advance compare product, GPU,...
- Smart database - Saving your history chat and your custom skill to make your personal AI Agents
- Will add soon...

## SETUP
### PREREQUISITES

- Node.js (16.11+ or higher)
- Python (3.13+ or higher)
- Docker Desktop (latest version)
- Discord/telegram bot token

### Install and run
1. Get the source code and create the local environment file:
```bash
git clone https://github.com/sn00bol/zeus.git
cd zeus
```

2. Run the interactive setup:
```bash
python setup.py
```
This script run both `pip install` and `npm install`, so you dont have to install dependencies single of them (and get fail lol)

3. Start the app while Docker Desktop is ready:
```bash
python app.py
```
Add `--logs` to keep Discord and bridge logs out of the console while running:
```bash
python app.py --logs
```
With this option, only bridge startup/health lines and the ZEUS ready message
are shown. Full process logs are saved under `logs/` when ZEUS shuts down.

In Discord, run `/model list` to scan local Ollama, LM Studio, and llama.cpp
providers, `/model set` with an exact provider/model pair to select one for
the current server (or DM user), or `/model auto` to scan again and select the
first loaded model for each new answer. Mention ZEUS with a prompt in a server
text channel (for example, `@ZEUS do you know Napoleon?`) to create a thread
from that message and get an immediate answer. Continue chatting by sending
messages in the thread. ZEUS responds only in public threads it created from a
mention; there is no separate `/chat` command.

Shared application services are in `core/`. Provider adapters remain under
`src/provider/`; the core model manager handles provider/model discovery,
short-lived model caching, optional provider API tokens, and common request
context. Conversation sessions and message history are persisted in the shared
PostgreSQL database.

Optional backend credentials can be set with `OLLAMA_API_KEY`,
`LMSTUDIO_API_KEY`, or `LLAMACPP_API_KEY`; `ZEUS_MODEL_TOKEN` is the shared
fallback. Credentials are sent as bearer tokens and are not stored with chat
history.

ZEUS also keeps short-term cross-thread memory for each user and platform. It
stores recent question/answer pairs, retrieves only text relevant to the next
question, and deletes memories after 30 days without being recalled. Memory
content is scoped to its owner and can be cleared for a user through the
`MemoryStore.forget_user` core service.

In ZEUS chat threads, `Zreset` clears that thread's history and token totals
without deleting long-term memory; `Zretry` retries its last unanswered
prompt; `Zusage` and `Zstatus` show usage and runtime status. `Znew [prompt]`
creates another public chat thread. Server managers can use `Zhome` to restrict
new bot mentions to the current text channel or `Zhome clear` to remove that
restriction. Configure comma-separated `OWNER_ID` values for `Zrestart` and
`Zstop`; those two commands require starting through `python app.py`.

The current Compose setup contains only PostgreSQL; the Discord bot and AI
bridge run as host processes. Consequently `Zrestart` restarts the supervised
Discord process but does not rebuild a ZEUS Docker image. `python -m core.version`
prints the release version with a short Git commit suffix when Git metadata is
available; Docker image tagging will take effect once the app is added as a
Compose build service.

Now your bot is alive and enjoy!

## Contributing
Zeus is openly welcome who pull request and contributing to this small project, for more details you can read [CONTRIBUTING.md](CONTRIBUTING.md)

## Security
This project DOES NOT collect any your data information, your Oauth key for shady motives. So at least you should keep private data away and any else about you

## License
Zeus is using GNU GPL v3.0 License, for more detail check it [here](LICENSE).

---
thx for read ts, have a gut day bradar