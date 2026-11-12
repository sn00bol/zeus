# CHANGELOG

## v1.1.0 - 11.12.2026
Release note:

1. This version currently work stable on WebUI and Discord, telegram are in expirements and testing, setup.py are sometimes "dumb"
2. This version **HIGHLY** supporting for Ollama Provider (cuz it my main), if you using LMStudio or llama.cpp you could face bug and glitch or not fully feature for your provider

What changed:
- Refactor entirely platform selection and remove 'PLATFORM' in `.env`, fix HTTP bugs ([d8db3c3](https://github.com/sn00bol/zeus/commit/d8db3c3fc67247e9fa8e26b28251885ea8f57c21))
- Unify websocket manager
- Move `MODEL`, `PROVIDER`, `OLLAMA API KEY` in `.env` into database ([8381624](https://github.com/sn00bol/zeus/commit/8381624dcbb0747c0621d9674e23ee66103e46a0))
- Add limit text on platform to prevent not fully display or send prompt too long at platform ([9dbc515](https://github.com/sn00bol/zeus/commit/9dbc5154a63a071f5f9b51970c2942894f867c38))
- Add supporting rendering for Telegram ([15ee1c6](https://github.com/sn00bol/zeus/commit/15ee1c67013f92f64db5f88d470d2807a28f0dd6))
- Fix model command on Discord/Telegram ([15ee1c6](https://github.com/sn00bol/zeus/commit/15ee1c67013f92f64db5f88d470d2807a28f0dd6))
- Fix only detect when select local model and ollama cloud model ([d8db3c3](https://github.com/sn00bol/zeus/commit/d8db3c3fc67247e9fa8e26b28251885ea8f57c21))