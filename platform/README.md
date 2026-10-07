<p align="center">
  <strong>ZEUS Platform notes</strong>
</p>

# Telegram platform

# Discord platform

If you're planning to add commands, develop features, or debug the bot, running it directly with Node.js is recommended

Chat and maintenance commands are prefix commands. Use `Znew [prompt]` to
start a public thread, `Zreset` to clear its current history, `Zretry` to retry
the last unanswered prompt, `Zusage` and `Zstatus` to inspect usage, and
`Zhome` / `Zhome clear` to configure the server's mention channel. `Zrestart`
and `Zstop` are owner-only and require starting ZEUS through `python app.py`;
set one or more comma-separated Discord user IDs in `OWNER_ID`.

The current `compose.yaml` runs PostgreSQL only. Bot restarts are handled by
the host supervisor and do not build or pull an application image.

traditional `npm run`, there three ways to use it:
```
npm run start  # Fast testing

npm run dev    # Allow to restart bot via save file

npm run test   # test if it's bugging or not
```

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
ZEUS Platform is based on Santaa v1.3.0 Debloat Version and built in Telegram bot and is using Apache-2.0 License, see [LICENSE](https://github.com/sn00bol/De-santaa/blob/main/LICENSE) for more details
