# CHANGELOG

## v1.0.0 - 11.08.2026
Release note:

1. This version currently work stable on WebUI and Discord, telegram are in expirements and testing, setup.py are sometimes "dumb"
2. This version **HIGHLY** supporting for Ollama Provider (cuz it my main), if you using LMStudio or llama.cpp you could face bug and glitch or not fully feature for your provider

What changed:
- Add ZEUS WebUI with basic task and add image, file
- Add title generator [8df964c](https://github.com/sn00bol/zeus/commit/8df964c4d07ab40501dd304241fb0e2d6aeb7cfd)
- Add docker and docker CI/CD workflows ([a2156e7](https://github.com/sn00bol/zeus/commit/a2156e7a413054a1f5fc5ce00ee1b4f15a2e9395))
- Add discord/telegram platform ([1965ee6](https://github.com/sn00bol/zeus/commit/1965ee62c952cf871270d4b01e388050ad578cf2), [87317f7](https://github.com/sn00bol/zeus/commit/87317f71963874592c3632118d670b89192d8799))
- Add router for multiple platform and ollama / lmstudio / llamacpp support ([2f91f17](https://github.com/sn00bol/zeus/commit/2f91f17b28179d4ef39d4a8e8f58cb5116492f9e), [1965ee6](https://github.com/sn00bol/zeus/commit/1965ee62c952cf871270d4b01e388050ad578cf2))
- Add some commands for discord/telegram platform: `home`, `model`, `new`, `reset`, `restart`, `retry`, `status`, `stop`, `usage`
- Make when AI responding scrollable, rework 3 dots button, fix PDF/Docx import broken, upgrade Title generator ([1cc1213](https://github.com/sn00bol/zeus/commit/1cc1213c0cdd1f8c581015542975ab85207dc78c))
- Fix temp chat theme and not delete, still visible ([ad97dc3](https://github.com/sn00bol/zeus/commit/ad97dc34023deb9917302b517361c02b0cae839f))
- Fix, upgrade WebUI render and sidebar ([796cd37](https://github.com/sn00bol/zeus/commit/796cd37031f45dd37466ea877eb6dbdd4d60ec4f))
- Fix WebUI AI Model thinking bugs ([bcecfce](https://github.com/sn00bol/zeus/commit/bcecfce19d6f808c967ee03b0833cf84958f1fd3))
- Fix postgressql bug WebUI server exited during startup ([2626433](https://github.com/sn00bol/zeus/commit/2626433cf1c83059e29c7b1342437443b214cb43))
