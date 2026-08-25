import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH should point at a Railway Volume mount (e.g. /data/trip.db) so
// data survives redeploys. Falls back to a local file for quick testing.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'trip.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS overrides (
    event_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- overrides: one row per edited event ----
app.get('/api/overrides', (req, res) => {
  const rows = db.prepare('SELECT event_id, data FROM overrides').all();
  const result = {};
  rows.forEach(r => { result[r.event_id] = JSON.parse(r.data); });
  res.json(result);
});

app.put('/api/overrides/:id', (req, res) => {
  const id = req.params.id;
  db.prepare(`
    INSERT INTO overrides (event_id, data) VALUES (?, ?)
    ON CONFLICT(event_id) DO UPDATE SET data = excluded.data
  `).run(id, JSON.stringify(req.body));
  res.json(req.body);
});

// ---- meta: small key/value store (e.g. "log-last-export" timestamp) ----
app.get('/api/meta/:key', (req, res) => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(req.params.key);
  res.json({ value: row ? row.value : null });
});

app.put('/api/meta/:key', (req, res) => {
  const { value } = req.body;
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(req.params.key, value);
  res.json({ value });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loe trip site listening on port ${PORT}`));
