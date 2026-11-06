<div align="center">
<img alt="ZEUS" src="assets/ZEUS.png" />
  <p>A self-hosting AI Agent for WebUI, Discord, and Telegram</p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="docs/SETUP.md">Full setup</a> ·
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
  <p>
    <a href="https://github.com/sn00bol/zeus/releases"><img src="https://img.shields.io/github/v/release/sn00bol/zeus?include_prereleases" alt="GitHub Release" /></a>
    <a href="https://github.com/sn00bol/zeus/actions"><img src="https://img.shields.io/github/actions/workflow/status/sn00bol/zeus/ci.yml" alt="Release Build Status" /></a>
    <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License" /></a>
  </p>
</div>

## Features (DEMO)
- **Literrally a chatbot** — You can ask anything all the earth, chatting like friends, explaining, do a basic math equations,...
- **Analysis documents** — Support writing, spelling error checks, suggestion and basic Text Editor
- **Searching with SearXNG** — Automatically decides when live web evidence is useful, adapts follow-up retrieval to result quality, and supports deep research. Use `@search` to force a lookup.
- **Smart database** — Saving your history chat and your custom skill to make your personal AI Agents

## Quick start
```bash
git clone https://github.com/sn00bol/zeus.git
cd zeus
python setup.py
docker compose up --build -d
```

The WebUI is available at `http://localhost:3000` (or the port configured by `WEBUI_PORT` in `.env`), Discord and Telegram can both run alongside it when selected in `setup.py` and configured in `.env` (`PLATFORM`).

For full native install, running docker, update and troubleshooting instruct, check at [setup guide](docs/SETUP.md).

## Contributing
Zeus is openly welcome who pull request and contributing to this small project, for more details you can read [CONTRIBUTING.md](CONTRIBUTING.md)

## Security
This project DOES NOT collect any your data information, your Oauth key for shady motives. So at least you should keep private data away and any else about you

To read about version supporting and reporting a vulnerability, check at [SECURITY.md](SECURITY.md)

## License
Zeus is using GNU GPL v3.0 License, for more detail check it [here](LICENSE).

---
thx for read ts, have a gut day bradar
