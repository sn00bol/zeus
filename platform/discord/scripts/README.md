Conversation history is stored in the shared PostgreSQL database as portable
JSONB messages. Export or import it from the project root:

```bash
node database/history.js export database/history.json
node database/history.js import database/history.json
```

To create a PostgreSQL dump with the default setup credentials:

```bash
docker compose exec -T postgres pg_dump -U zeus zeus > database/zeus-backup.sql
```

The exported JSON history is platform-neutral and can be imported after moving
to another platform. Keep database dumps and history exports private because
they contain user messages.
