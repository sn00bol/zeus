<p align="center">
  <strong>ZEUS Platform notes</strong>
</p>

If you're planning to add commands, develop features, or debug the bot, running it directly with Node.js is recommended

The current `compose.yaml` runs PostgreSQL only. Bot restarts are handled by
the host supervisor and do not build or pull an application image.

Run the selected platform with the same scripts:
```
npm start      # Start the platform configured in .env

npm run dev    # Restart on file changes

npm test       # Run the test suite
```

Platform commands:
```bash
npm run register-commands  # Uses PLATFORM from .env to sync the command menu
npm run healthcheck         # Check the local bot health endpoint
```

The health endpoint is enabled with `ENABLE_DOCKER_HEALTHCHECK=true` and
defaults to `127.0.0.1:3000/health`. Override its bind address with
`HEALTHCHECK_HOST` and port with `HEALTHCHECK_PORT`. It reports ready only after
the database is initialized and the selected platform authenticates.

Cautions:
`npm run test` only run like this: 
```bash
PS D:\zeus> npm run test

> zeus-discord-platform test
> node --test

ℹ tests 0
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 101.1713
PS D:\zeus> 
```
To more advance test, please create `/test` folder and its `*.test.js` file for more advance

## LICENSE
ZEUS Platform is based on Santaa v1.3.0 Debloat Version with built in Telegram platform and is using Apache-2.0 License, see [LICENSE](https://github.com/sn00bol/De-santaa/blob/main/LICENSE) for more details
