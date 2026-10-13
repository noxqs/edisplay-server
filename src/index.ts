import "dotenv/config";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createServer } from "./server.js";

const cfg = loadConfig();
const db = openDb(cfg.dbFile);
const app = createServer(cfg, db);

app.listen(cfg.port, () => {
  console.log(`[photoframe-server] listening on :${cfg.port}`);
  console.log(`[photoframe-server] immich=${cfg.immichBaseUrl}`);
  console.log(`[photoframe-server] default=${cfg.defaultWidth}x${cfg.defaultHeight} ${cfg.defaultOrientation} preset=${cfg.convertPreset}`);
  console.log(`[photoframe-server] setup/select albums at http://localhost:${cfg.port}/admin`);
});
