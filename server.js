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
    return { overrides: {}, meta: {}, newEvents: [], expenses: [], customPeople: [] };
  }
}

function saveStore(store) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt the file.
  const tmp = dataPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, dataPath);
}

if (!fs.existsSync(dataPath)) {
  saveStore({ overrides: {}, meta: {}, newEvents: [], expenses: [], customPeople: [] });
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

// ---- expenses: shared trip expense ledger ----
app.get('/api/expenses', (req, res) => {
  const store = loadStore();
  res.json({ expenses: store.expenses || [], customPeople: store.customPeople || [] });
});

app.post('/api/expenses', (req, res) => {
  const store = loadStore();
  store.expenses = Array.isArray(req.body.expenses) ? req.body.expenses : [];
  saveStore(store);
  res.json(store.expenses);
});

app.post('/api/people', (req, res) => {
  const store = loadStore();
  store.customPeople = Array.isArray(req.body.customPeople) ? req.body.customPeople : [];
  saveStore(store);
  res.json(store.customPeople);
});

// ---- backup: the entire live-edited data store, read straight from disk ----
// (the base itinerary structure itself lives in GitHub already; this covers
// everything that only exists in the Railway Volume \u2014 overrides, new
// events, expenses, and custom people.)
app.get('/api/backup', (req, res) => {
  const store = loadStore();
  res.json(store);
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

// ---- chat-to-update: parse a plain-English message into a proposed diff ----
function buildSystemPrompt(events, people, days) {
  const trimmedEvents = events.map(e => ({
    id: e.id, title: e.title, category: e.category, dates: e.dates, time: e.time,
    location: e.location, room: e.room, who: e.who, conf: e.conf,
    payStatus: e.payPill ? e.payPill.kind : null, notes: e.notes
  }));

  return `You maintain a shared family trip itinerary. A family member will send a plain-English message describing a change, correction, or addition. Respond with ONLY valid JSON (no prose, no markdown fences) matching exactly this schema:

{
  "summary": "one short sentence describing the proposed change(s), for a human to review before applying",
  "changes": [
    { "type": "update", "eventId": <number, must match an existing event id below>, "patch": { /* only fields that are actually changing */
        "time": "<string, optional>",
        "location": "<string, optional>",
        "room": "<string, optional>",
        "conf": "<string, optional>",
        "payStatus": "<one of: paid, unpaid, pending, hidden \u2014 optional>",
        "notes": "<string, optional \u2014 write a full replacement, not a diff>",
        "who": ["<FULL replacement list of attendee codes for this event, optional \u2014 only include if attendance is changing>"]
    }},
    { "type": "create", "event": {
        "dates": ["<one or more exact date strings from the trip-days list below>"],
        "time": "<string, or 'TBD' if unknown>",
        "category": "<one of: Flight, Drive, Stay, Golf, Dine, Show, Personal>",
        "title": "<short string>",
        "location": "<string>",
        "room": "<string or null>",
        "who": ["<attendee codes>"],
        "conf": "<string or null>",
        "payStatus": "<one of: paid, unpaid, pending, hidden, or null>",
        "notes": "<string>"
    }}
  ],
  "needsClarification": "<a short question, ONLY if the message is too ambiguous to act on confidently \u2014 otherwise null, and leave changes as an empty array>"
}

Rules:
- A single message can produce multiple entries in "changes" (e.g. removing someone from one event AND adding new events for them).
- Never invent confirmation numbers, prices, or specific details that weren't stated \u2014 leave those fields out entirely rather than guessing.
- Use the exact attendee codes shown below in "who", not full names.
- If nothing in the message maps to a clear, confident action, use "needsClarification" instead of guessing at a change.

Known travelers (code \u2014 full name):
${people.map(p => `${p.code} \u2014 ${p.name}`).join('\n')}

Trip days (exact date string \u2014 weekday, label):
${days.map(d => `${d.date} \u2014 ${d.weekday} ${d.label}`).join('\n')}

Current events (use "id" for updates):
${JSON.stringify(trimmedEvents)}`;
}

app.post('/api/parse-update', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server. Add it in Railway\u2019s Variables tab.' });
    }
    const { message, events, people, days } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: buildSystemPrompt(events || [], people || [], days || []),
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(500).json({ error: (data.error && data.error.message) || 'Claude API request failed.' });
    }

    const text = (data.content || []).map(block => block.text || '').join('');
    let parsed;
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({ error: 'Could not parse a valid response from Claude.', raw: text });
    }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loe trip site listening on port ${PORT}`));
