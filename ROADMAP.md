ZEUS Roadmap

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
- skills/                     -> SOUL, SAFETY, SKILL.md, catalog, and skill runtime
- tools/                      -> AI Agents tools


Database: PostgresSQL

TODOS:
- Add AI Agents sandbox enviroments to test running python code, testing, debug,...
- Add limit text on platform to prevent not fully display or send prompt too long, and platform have max token
- Add temporarily chat, search SEARXNG
- Add supporting rendering for Telegram, math/chemical stuff
- Add random text for fun when start new chat
- Improving webui and menu bar, format text
- Add ZEUS Webui settings, model selection more advance
- Add search, pin, support image/file,... (and no limits)