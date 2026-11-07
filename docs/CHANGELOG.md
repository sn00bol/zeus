# CHANGELOG

## v1.0.0 - 10.31.2026
Release note:

This version currently work perfectly on WebUI and Discord, telegram are in expirements and testing, setup.py are sometimes "dumb" and always required WebUI as default

What changed:
- Add ZEUS WebUI with basic task and add image, file
- Add docker and docker CI/CD workflows ([a2156e7](https://github.com/sn00bol/zeus/commit/a2156e7a413054a1f5fc5ce00ee1b4f15a2e9395))
- Add discord/telegram platform ([1965ee6](https://github.com/sn00bol/zeus/commit/1965ee62c952cf871270d4b01e388050ad578cf2), [87317f7](https://github.com/sn00bol/zeus/commit/87317f71963874592c3632118d670b89192d8799))
- Add router for multiple platform and ollama / lmstudio / llamacpp support ([2f91f17](https://github.com/sn00bol/zeus/commit/2f91f17b28179d4ef39d4a8e8f58cb5116492f9e), [1965ee6](https://github.com/sn00bol/zeus/commit/1965ee62c952cf871270d4b01e388050ad578cf2))
- Add some commands for discord/telegram platform: `home`, `model`, `new`, `reset`, `restart`, `retry`, `status`, `stop`, `usage`
- Fix, upgrade WebUI render and sidebar ([796cd37](https://github.com/sn00bol/zeus/commit/796cd37031f45dd37466ea877eb6dbdd4d60ec4f))
- Fix WebUI AI Model thinking bugs ([bcecfce](https://github.com/sn00bol/zeus/commit/bcecfce19d6f808c967ee03b0833cf84958f1fd3))
- Fix postgressql bug WebUI server exited during startup ([2626433](https://github.com/sn00bol/zeus/commit/2626433cf1c83059e29c7b1342437443b214cb43))
