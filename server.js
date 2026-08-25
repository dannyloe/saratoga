import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_PATH should point at a Railway Volume mount (e.g. /data/trip-data.json)
// so edits survive redeploys. Falls back to a local file for quick testing.
const dataPath = process.env.DATA_PATH || path.join(__dirname, 'trip-data.json');
fs.mkdirSync(path.dirname(dataPath), { recursive: true });

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    return { overrides: {}, meta: {}, newEvents: [] };
  }
}

function saveStore(store) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt the file.
  const tmp = dataPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, dataPath);
}

if (!fs.existsSync(dataPath)) {
  saveStore({ overrides: {}, meta: {}, newEvents: [] });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- overrides: one entry per edited event ----
app.get('/api/overrides', (req, res) => {
  const store = loadStore();
  res.json(store.overrides || {});
});

app.put('/api/overrides/:id', (req, res) => {
  const store = loadStore();
  store.overrides = store.overrides || {};
  store.overrides[req.params.id] = req.body;
  saveStore(store);
  res.json(req.body);
});

// ---- new-events: brand-new events the group has added ----
app.get('/api/new-events', (req, res) => {
  const store = loadStore();
  res.json(store.newEvents || []);
});

app.post('/api/new-events', (req, res) => {
  const store = loadStore();
  store.newEvents = Array.isArray(req.body) ? req.body : [];
  saveStore(store);
  res.json(store.newEvents);
});

// ---- meta: small key/value store (e.g. "log-last-export" timestamp) ----
app.get('/api/meta/:key', (req, res) => {
  const store = loadStore();
  const value = store.meta && store.meta[req.params.key] != null ? store.meta[req.params.key] : null;
  res.json({ value });
});

app.put('/api/meta/:key', (req, res) => {
  const store = loadStore();
  store.meta = store.meta || {};
  store.meta[req.params.key] = req.body.value;
  saveStore(store);
  res.json({ value: req.body.value });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loe trip site listening on port ${PORT}`));
