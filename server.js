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

let inboxes = new Map();
let sseClients = new Map();

function loadMails() {
  try {
    if (fs.existsSync(MAILS_FILE)) {
      const raw = fs.readFileSync(MAILS_FILE, "utf-8");
      const data = JSON.parse(raw);
      for (const [key, mails] of Object.entries(data)) {
        inboxes.set(key, mails);
      }
    }
  } catch (e) {
    console.error("Failed to load mails:", e.message);
  }
}

function saveMails() {
  try {
    const obj = Object.fromEntries(inboxes);
    fs.writeFileSync(MAILS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("Failed to save mails:", e.message);
  }
}

loadMails();

function notifySSE(address) {
  const clients = sseClients.get(address);
  if (!clients) return;
  const mails = inboxes.get(address) || [];
  const data = JSON.stringify(mails);
  for (const res of clients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (e) {}
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
  saveMails();
  res.json({ ok: true, address });
});

app.get("/register/api/inbox/:name", (req, res) => {
  const address = req.params.name;
  if (!address) {
    return res.json({ ok: false, error: "address required" });
  }
  const mails = inboxes.get(address) || [];
  const list = mails.map((m) => ({
    id: m.id,
    from: m.from,
    subject: m.subject,
    time: m.time,
  }));
  res.json({ ok: true, list });
});

app.get("/register/api/inbox/:name/:id", (req, res) => {
  const { name, id } = req.params;
  const mails = inboxes.get(name);
  if (!mails) {
    return res.json({ ok: false, error: "inbox not found" });
  }
  const mail = mails.find((m) => m.id === id);
  if (!mail) {
    return res.json({ ok: false, error: "mail not found" });
  }
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
  if (!address) {
    return res.status(400).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const mails = inboxes.get(address) || [];
  res.write(`data: ${JSON.stringify(mails)}\n\n`);

  if (!sseClients.has(address)) {
    sseClients.set(address, new Set());
  }
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
    saveMails();
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

  recipients.forEach((recipient) => {
    const addr = extractEmail(recipient);
    storeMail(addr, from, subject || "(no subject)", text || "", htmlBody || "");
  });

  saveMails();
  res.json({ ok: true });
});

function storeMail(addr, from, subject, text, html) {
  if (!inboxes.has(addr)) {
    inboxes.set(addr, []);
  }
  const mail = {
    id: uuidv4(),
    from,
    to: addr,
    subject,
    time: new Date().toISOString(),
    text,
    html,
  };
  inboxes.get(addr).push(mail);
  notifySSE(addr);
}

app.get("/register/api/inbox/:name/delete/:id", (req, res) => {
  const { name, id } = req.params;
  const mails = inboxes.get(name);
  if (!mails) {
    return res.json({ ok: false, error: "inbox not found" });
  }
  const idx = mails.findIndex((m) => m.id === id);
  if (idx === -1) {
    return res.json({ ok: false, error: "mail not found" });
  }
  mails.splice(idx, 1);
  saveMails();
  notifySSE(name);
  res.json({ ok: true });
});

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Domain: ${DOMAIN}`);
});
