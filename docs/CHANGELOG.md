# CHANGELOG

## v1.0.0 - 11.08.2026
Release note:

1. This version currently work stable on WebUI and Discord, telegram are in expirements and testing, setup.py are sometimes "dumb"
2. This version **HIGHLY** supporting for Ollama Provider (cuz it my main), if you using LMStudio or llama.cpp you could face bug and glitch or not fully feature for your provider

What changed:
- Refactor entirely platform selection and remove 'PLATFORM' in `.env`, fix HTTP bugs ([d8db3c3](https://github.com/sn00bol/zeus/commit/d8db3c3fc67247e9fa8e26b28251885ea8f57c21))
- Unify websocket manager, make more shorten name in ENV
- Allow to use search engine on platform
- Add limit text on platform to prevent not fully display or send prompt too long, and platform have max token
- Add supporting rendering for Telegram
- Fix sidebar overlay
- Fix model command on Discord/Telegram
- Fix only detect when select local model and ollama cloud model ([d8db3c3](https://github.com/sn00bol/zeus/commit/d8db3c3fc67247e9fa8e26b28251885ea8f57c21))