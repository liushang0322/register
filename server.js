const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { simpleParser } = require("mailparser");

const app = express();
const PORT = process.env.PORT || 5454;
const DOMAIN = process.env.DOMAIN || "lshang.top";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

app.use(express.json({ limit: "10mb" }));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAILS_FILE = path.join(DATA_DIR, "mails.json");
const META_FILE = path.join(DATA_DIR, "meta.json");

let inboxes = new Map();
let inboxMeta = new Map();
let sseClients = new Map();

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load", file, e.message);
  }
  return {};
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save", file, e.message);
  }
}

function loadData() {
  const mailsData = loadJSON(MAILS_FILE);
  for (const [key, mails] of Object.entries(mailsData)) {
    inboxes.set(key, mails);
  }
  const metaData = loadJSON(META_FILE);
  for (const [key, meta] of Object.entries(metaData)) {
    inboxMeta.set(key, meta);
  }
  for (const [key, mails] of inboxes) {
    if (!inboxMeta.has(key)) {
      inboxMeta.set(key, { note: "", password: "", createdAt: mails[0]?.time || new Date().toISOString() });
    }
  }
}

function saveAll() {
  saveJSON(MAILS_FILE, Object.fromEntries(inboxes));
  saveJSON(META_FILE, Object.fromEntries(inboxMeta));
}

loadData();

function notifySSE(address) {
  const clients = sseClients.get(address);
  if (!clients) return;
  const mails = inboxes.get(address) || [];
  const data = JSON.stringify({ address, mails });
  for (const res of clients) {
    try { res.write(`data: ${data}\n\n`); } catch (e) {}
  }
}

function notifyAllSSE() {
  for (const [address] of sseClients) {
    notifySSE(address);
  }
}

app.use("/register", express.static(path.join(__dirname, "public")));

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/register/api/inbox/create", (req, res) => {
  const prefix = uuidv4().slice(0, 8);
  const address = `${prefix}@${DOMAIN}`;
  inboxes.set(address, []);
  inboxMeta.set(address, { note: "", password: "", createdAt: new Date().toISOString() });
  saveAll();
  res.json({ ok: true, address });
});

app.post("/register/api/inbox/create-batch", (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count) || 1, 1), 50);
  const addresses = [];
  for (let i = 0; i < count; i++) {
    const prefix = uuidv4().slice(0, 8);
    const address = `${prefix}@${DOMAIN}`;
    inboxes.set(address, []);
    inboxMeta.set(address, { note: "", password: "", createdAt: new Date().toISOString() });
    addresses.push(address);
  }
  saveAll();
  res.json({ ok: true, addresses });
});

app.get("/register/api/inbox", (req, res) => {
  const list = [];
  for (const [address, meta] of inboxMeta) {
    const mails = inboxes.get(address) || [];
    list.push({
      address,
      note: meta.note || "",
      password: meta.password || "",
      createdAt: meta.createdAt,
      mailCount: mails.length,
    });
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ok: true, list });
});

app.put("/register/api/inbox/:name/meta", (req, res) => {
  const address = req.params.name;
  if (!inboxMeta.has(address)) {
    return res.json({ ok: false, error: "inbox not found" });
  }
  const { note, password } = req.body;
  const meta = inboxMeta.get(address);
  if (note !== undefined) meta.note = note;
  if (password !== undefined) meta.password = password;
  saveAll();
  res.json({ ok: true });
});

app.delete("/register/api/inbox/:name", (req, res) => {
  const address = req.params.name;
  inboxes.delete(address);
  inboxMeta.delete(address);
  saveAll();
  const clients = sseClients.get(address);
  if (clients) {
    for (const c of clients) c.end();
    sseClients.delete(address);
  }
  res.json({ ok: true });
});

app.get("/register/api/inbox/:name", (req, res) => {
  const address = req.params.name;
  const mails = inboxes.get(address) || [];
  const list = mails.map((m) => ({
    id: m.id,
    from: m.from,
    subject: m.subject,
    time: m.time,
  }));
  const meta = inboxMeta.get(address);
  res.json({
    ok: true,
    list,
    meta: meta || { note: "", password: "" },
  });
});

app.get("/register/api/inbox/:name/:id", (req, res) => {
  const { name, id } = req.params;
  const mails = inboxes.get(name);
  if (!mails) return res.json({ ok: false, error: "inbox not found" });
  const mail = mails.find((m) => m.id === id);
  if (!mail) return res.json({ ok: false, error: "mail not found" });
  res.json({
    ok: true,
    mail: {
      id: mail.id,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      time: mail.time,
      text: mail.text,
      html: mail.html,
    },
  });
});

app.get("/register/api/stream/:name", (req, res) => {
  const address = req.params.name;
  if (!address) return res.status(400).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const mails = inboxes.get(address) || [];
  res.write(`data: ${JSON.stringify({ address, mails })}\n\n`);
  if (!sseClients.has(address)) sseClients.set(address, new Set());
  sseClients.get(address).add(res);
  req.on("close", () => {
    const clients = sseClients.get(address);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(address);
    }
  });
});

app.post("/register/webhook/mail", async (req, res) => {
  const { raw } = req.body;
  if (raw) {
    try {
      const parsed = await simpleParser(raw);
      const addr = parsed.to?.value?.[0]?.address?.toLowerCase();
      if (!addr || !parsed.from?.text) {
        return res.status(400).json({ ok: false, error: "invalid email" });
      }
      storeMail(addr, parsed.from.text, parsed.subject || "(no subject)", parsed.text || "", parsed.html || "");
    } catch (e) {
      console.error("Mail parse error:", e.message);
      return res.json({ ok: true });
    }
    saveJSON(MAILS_FILE, Object.fromEntries(inboxes));
    return res.json({ ok: true });
  }

  const { to, from, subject, text, html: htmlBody } = req.body;
  if (!to || !from) {
    return res.status(400).json({ ok: false, error: "to and from required" });
  }
  function extractEmail(str) {
    const m = str.match(/<([^>]+@[^>]+)>/);
    if (m) return m[1].trim().toLowerCase();
    return str.trim().toLowerCase();
  }
  const recipients = typeof to === "string" ? to.split(/,\s*/) : [to];
  recipients.forEach((r) => {
    const addr = extractEmail(r);
    storeMail(addr, from, subject || "(no subject)", text || "", htmlBody || "");
  });
  saveJSON(MAILS_FILE, Object.fromEntries(inboxes));
  res.json({ ok: true });
});

function storeMail(addr, from, subject, text, html) {
  if (!inboxMeta.has(addr)) {
    inboxMeta.set(addr, { note: "", password: "", createdAt: new Date().toISOString() });
  }
  if (!inboxes.has(addr)) inboxes.set(addr, []);
  inboxes.get(addr).push({
    id: uuidv4(),
    from,
    to: addr,
    subject,
    time: new Date().toISOString(),
    text,
    html,
  });
  notifySSE(addr);
}

app.get("/register/api/inbox/:name/delete/:id", (req, res) => {
  const { name, id } = req.params;
  const mails = inboxes.get(name);
  if (!mails) return res.json({ ok: false, error: "inbox not found" });
  const idx = mails.findIndex((m) => m.id === id);
  if (idx === -1) return res.json({ ok: false, error: "mail not found" });
  mails.splice(idx, 1);
  saveJSON(MAILS_FILE, Object.fromEntries(inboxes));
  notifySSE(name);
  res.json({ ok: true });
});

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Domain: ${DOMAIN}`);
});
