<p align="center">
  <strong>ZEUS Platform notes</strong>
</p>

If you're planning to add commands, develop features, or debug a bot, run its
platform entrypoint directly with Node.js.

Discord and Telegram each keep their runtime in their platform folder. Their
command dispatch, database startup, slash registration, and platform-specific
command helpers are consolidated in `CommandHandler.js`; AI, bridge,
conversation, and chat-thread helpers are consolidated in `Adapter.js`.
Platform-specific code must remain local to its platform; do not add a shared
`core/platform` layer. The only nested folder in either platform is `commands`.

The current `compose.yaml` runs PostgreSQL only. Bot restarts are handled by

Run the database-configured platform selection with:
```
npm start      # Start the WebUI and bot platforms enabled in PostgreSQL

npm run dev    # Restart the supervisor when platform JavaScript files change

npm test       # Run the test suite
```

Platform commands:
```bash
npm run register-commands  # Sync command menus for enabled bot platforms
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
ZEUS Discord and Telegram are based on Santaa v1.3.0 Debloat Version is using Apache-2.0 License, see [LICENSE](https://github.com/sn00bol/De-santaa/blob/main/LICENSE) for more details
