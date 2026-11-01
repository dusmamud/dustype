import "dotenv/config";
import { createApp } from "./app.js";
import { initDb } from "./dal/db.js";

const port = Number(process.env.PORT ?? 5005);

// Phase 2 boot step: connect to Mongo and create indexes when
// DB_URI is set; no-op (in-memory stores) when it is not. A failed
// connection logs and falls back to in-memory rather than crashing.
await initDb();

const app = createApp();

app.listen(port, () => {
  console.log(`dustype backend listening on http://localhost:${port}`);
});
