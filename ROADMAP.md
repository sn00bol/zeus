ZEUS Roadmap

Goal
- Keep this as a practical map of the codebase.
- Show main folders and important files only (not every file).

Root
- setup.py                    -> Setup scripts auto install dependencies project
- requirements.txt            -> python dependencies for ZEUS
- package.json                -> javascript dependencies for discord bot
- README.md                   -> setup and usage docs
- SECURITY.md                 -> security policy
- scripts/                    -> utility/maintenance scripts
- router/                     -> Main router/LAN management and platform
- core/                       -> ZEUS Core
- logs/                       -> runtime log output
- src/                        -> main codebase
- webui                       -> ZEUS WebUI
- tests/                      -> unit tests

src/
- provider/                   -> LLM Config provider
- skills/                     -> AI Agents skill
- tools/                      -> AI Agents tools


Database
- PostgreSQL (primary) with in-memory fallback for development
- Graceful degradation when PostgreSQL is unavailable

TODOS:
- Add random text for fun when start new chat
- Improving webui and menu bar, format text
- Add ZEUS Webui settings, model selection more advance
- Add search, pin, support image/file,... (and no limits)