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
const OPENAI_CHATGPT_SIGNUP_URL = process.env.OPENAI_CHATGPT_SIGNUP_URL || "https://chatgpt.com/auth/login/";
const OPENAI_API_SIGNUP_URL = process.env.OPENAI_API_SIGNUP_URL || "https://platform.openai.com/signup?source=standard";

app.use(express.json({ limit: "10mb" }));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAILS_FILE = path.join(DATA_DIR, "mails.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const REGISTRATION_JOBS_FILE = path.join(DATA_DIR, "registration-jobs.json");

let inboxes = new Map();
let inboxMeta = new Map();
let accounts = new Map();
let registrationJobs = new Map();
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

  const accountsData = loadJSON(ACCOUNTS_FILE);
  const accountList = Array.isArray(accountsData) ? accountsData : Object.values(accountsData);
  for (const account of accountList) {
    if (account && account.id) {
      accounts.set(account.id, account);
    }
  }

  const jobsData = loadJSON(REGISTRATION_JOBS_FILE);
  const jobList = Array.isArray(jobsData) ? jobsData : Object.values(jobsData);
  for (const job of jobList) {
    if (job && job.id) {
      registrationJobs.set(job.id, job);
    }
  }
}

function saveAll() {
  saveJSON(MAILS_FILE, Object.fromEntries(inboxes));
  saveJSON(META_FILE, Object.fromEntries(inboxMeta));
  saveJSON(ACCOUNTS_FILE, Array.from(accounts.values()));
  saveJSON(REGISTRATION_JOBS_FILE, Array.from(registrationJobs.values()));
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

app.use("/register", express.static(path.join(__dirname, "public")));

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/register/api/health", (req, res) => {
  const checks = [];
  let writable = false;
  try {
    const probe = path.join(DATA_DIR, `.health-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    writable = true;
  } catch (e) {
    checks.push({ name: "dataWrite", ok: false, message: e.message });
  }

  checks.push({ name: "server", ok: true, message: "running" });
  checks.push({ name: "dataDir", ok: fs.existsSync(DATA_DIR), message: DATA_DIR });
  checks.push({ name: "dataWrite", ok: writable, message: writable ? "writable" : "not writable" });
  checks.push({ name: "mailStore", ok: true, message: `${inboxes.size} inboxes` });
  checks.push({ name: "accountStore", ok: true, message: `${accounts.size} accounts` });
  checks.push({ name: "registrationJobs", ok: true, message: `${registrationJobs.size} jobs` });

  res.json({
    ok: checks.every((item) => item.ok),
    domain: DOMAIN,
    dataDir: DATA_DIR,
    inboxCount: inboxMeta.size,
    accountCount: accounts.size,
    registrationJobCount: registrationJobs.size,
    checks,
    time: new Date().toISOString(),
  });
});

app.post("/register/api/diagnostics/mail-capture", async (req, res) => {
  const address = extractEmail(req.body?.address) || `selftest-${Date.now()}@${DOMAIN}`.toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const before = (inboxes.get(address) || []).length;
  const raw = [
    "From: Register Self Test <self-test@register.local>",
    `To: ${address}`,
    `Subject: Register mail capture test ${code}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `This is a self-test message. Verification code: ${code}`,
  ].join("\r\n");

  try {
    const parsed = await simpleParser(raw);
    const recipients = collectRecipients(parsed, { raw, to: address, from: "self-test@register.local" });
    for (const recipient of recipients) {
      storeMail(recipient, parsed.from.text, parsed.subject, parsed.text || "", parsed.html || "");
    }
    if (!inboxMeta.has(address)) {
      inboxMeta.set(address, { note: "系统自检邮箱", password: "", createdAt: new Date().toISOString() });
    }
    saveAll();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  const summary = summarizeMailbox(address, 5);
  const after = (inboxes.get(address) || []).length;
  res.json({
    ok: after > before,
    address,
    injectedCode: code,
    before,
    after,
    captured: after > before,
    mailbox: summary,
    checks: [
      { name: "rawParse", ok: true, message: "raw mail parsed" },
      { name: "webhookStore", ok: after > before, message: `${after - before} new message(s)` },
      { name: "mailFetch", ok: summary.mailCount === after, message: `${summary.mailCount} message(s) readable` },
      { name: "codeExtract", ok: summary.mails.some((mail) => mail.codes.includes(code)), message: code },
    ],
  });
});

app.post("/register/api/inbox/create", (req, res) => {
  const address = createInbox();
  saveAll();
  res.json({ ok: true, address });
});

app.post("/register/api/inbox/create-batch", (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count) || 1, 1), 50);
  const addresses = [];
  for (let i = 0; i < count; i++) {
    addresses.push(createInbox());
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
  for (const [id, account] of accounts) {
    if (account.email === address) accounts.delete(id);
  }
  saveAll();
  const clients = sseClients.get(address);
  if (clients) {
    for (const c of clients) c.end();
    sseClients.delete(address);
  }
  res.json({ ok: true });
});

app.get("/register/api/accounts", (req, res) => {
  const list = Array.from(accounts.values()).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ ok: true, list });
});

app.get("/register/api/register-jobs", (req, res) => {
  const list = Array.from(registrationJobs.values()).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ ok: true, list });
});

app.post("/register/api/register-jobs/openai", (req, res) => {
  const product = req.body?.product === "api" ? "api" : "chatgpt";
  const defaultUrl = product === "api" ? OPENAI_API_SIGNUP_URL : OPENAI_CHATGPT_SIGNUP_URL;
  const websiteUrl = normalizeUrl(req.body?.websiteUrl) || defaultUrl;
  const email = extractEmail(req.body?.email) || createInbox();
  const password = String(req.body?.password || generatePassword(18));
  const now = new Date().toISOString();
  const job = {
    id: uuidv4(),
    platform: "OpenAI",
    product,
    email,
    password,
    websiteUrl,
    status: "pending",
    note: String(req.body?.note || "OpenAI 半自动注册任务").trim(),
    createdAt: now,
    updatedAt: now,
    lastScan: null,
    accountId: "",
  };
  if (!inboxMeta.has(email)) {
    inboxes.set(email, inboxes.get(email) || []);
    inboxMeta.set(email, { note: "OpenAI 注册邮箱", password, createdAt: now });
  }
  registrationJobs.set(job.id, job);
  saveAll();
  res.json({ ok: true, job });
});

app.put("/register/api/register-jobs/:id", (req, res) => {
  const job = registrationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "registration job not found" });
  const allowed = ["status", "note", "websiteUrl", "password"];
  for (const key of allowed) {
    if (req.body && req.body[key] !== undefined) job[key] = String(req.body[key]).trim();
  }
  job.updatedAt = new Date().toISOString();
  registrationJobs.set(job.id, job);
  saveAll();
  res.json({ ok: true, job });
});

app.post("/register/api/register-jobs/:id/scan", (req, res) => {
  const job = registrationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "registration job not found" });
  const scan = scanOpenAIRegistrationMailbox(job.email);
  job.lastScan = scan;
  if (scan.openaiMailCount > 0 && job.status === "pending") job.status = "mail_received";
  job.updatedAt = new Date().toISOString();
  registrationJobs.set(job.id, job);
  saveAll();
  res.json({ ok: true, job, scan });
});

app.post("/register/api/register-jobs/:id/complete", (req, res) => {
  const job = registrationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "registration job not found" });
  const now = new Date().toISOString();
  let account = job.accountId ? accounts.get(job.accountId) : null;
  if (!account) {
    account = {
      id: uuidv4(),
      email: job.email,
      platform: job.product === "api" ? "OpenAI API" : "OpenAI ChatGPT",
      username: job.email,
      password: job.password,
      websiteUrl: job.websiteUrl,
      note: req.body?.note || job.note || "OpenAI 注册完成",
      createdAt: now,
      updatedAt: now,
    };
  } else {
    account.email = job.email;
    account.platform = job.product === "api" ? "OpenAI API" : "OpenAI ChatGPT";
    account.username = job.email;
    account.password = job.password;
    account.websiteUrl = job.websiteUrl;
    account.note = req.body?.note || account.note || job.note;
    account.updatedAt = now;
  }
  accounts.set(account.id, account);
  job.accountId = account.id;
  job.status = "completed";
  job.updatedAt = now;
  registrationJobs.set(job.id, job);
  saveAll();
  res.json({ ok: true, job, account });
});

app.delete("/register/api/register-jobs/:id", (req, res) => {
  if (!registrationJobs.has(req.params.id)) {
    return res.status(404).json({ ok: false, error: "registration job not found" });
  }
  registrationJobs.delete(req.params.id);
  saveAll();
  res.json({ ok: true });
});

app.post("/register/api/accounts", (req, res) => {
  const account = normalizeAccount(req.body || {});
  if (!account.email) {
    return res.status(400).json({ ok: false, error: "email is required" });
  }
  account.id = uuidv4();
  account.createdAt = new Date().toISOString();
  account.updatedAt = account.createdAt;
  accounts.set(account.id, account);
  saveAll();
  res.json({ ok: true, account });
});

app.put("/register/api/accounts/:id", (req, res) => {
  const account = accounts.get(req.params.id);
  if (!account) {
    return res.status(404).json({ ok: false, error: "account not found" });
  }
  const next = { ...account, ...normalizeAccount({ ...account, ...(req.body || {}) }) };
  next.id = account.id;
  next.createdAt = account.createdAt;
  next.updatedAt = new Date().toISOString();
  accounts.set(next.id, next);
  saveAll();
  res.json({ ok: true, account: next });
});

app.post("/register/api/accounts/:id/check", async (req, res) => {
  const account = accounts.get(req.params.id);
  if (!account) {
    return res.status(404).json({ ok: false, error: "account not found" });
  }

  const websiteUrl = normalizeUrl(req.body?.websiteUrl || account.websiteUrl || account.platform);
  const mailSnapshot = summarizeMailbox(account.email, 10);
  const siteCheck = await checkWebsite(websiteUrl);
  const result = {
    checkedAt: new Date().toISOString(),
    websiteUrl,
    site: siteCheck,
    mailbox: {
      ok: inboxes.has(account.email),
      email: account.email,
      mailCount: mailSnapshot.mailCount,
      latestAt: mailSnapshot.latestAt,
      latestCodes: mailSnapshot.latestCodes,
      latestSubjects: mailSnapshot.mails.slice(0, 3).map((mail) => mail.subject),
    },
  };

  account.websiteUrl = websiteUrl || account.websiteUrl || "";
  account.lastCheck = result;
  account.updatedAt = result.checkedAt;
  accounts.set(account.id, account);
  saveAll();

  res.json({ ok: true, account, result, mails: mailSnapshot.mails });
});

app.delete("/register/api/accounts/:id", (req, res) => {
  if (!accounts.has(req.params.id)) {
    return res.status(404).json({ ok: false, error: "account not found" });
  }
  accounts.delete(req.params.id);
  saveAll();
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

app.get("/register/api/inbox/:name/mail-content", (req, res) => {
  const address = extractEmail(req.params.name);
  if (!address || !inboxes.has(address)) {
    return res.status(404).json({ ok: false, error: "inbox not found" });
  }
  res.json({ ok: true, mailbox: summarizeMailbox(address, parseInt(req.query.limit, 10) || 20) });
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
      const recipients = collectRecipients(parsed, req.body);
      const from = parsed.from?.text || req.body.from || getHeader(req.body.headers, "from") || "";
      if (recipients.length === 0 || !from) {
        return res.status(400).json({ ok: false, error: "invalid email" });
      }
      for (const addr of recipients) {
        storeMail(addr, from, parsed.subject || "(no subject)", parsed.text || "", parsed.html || "");
      }
    } catch (e) {
      console.error("Mail parse error:", e.message);
      return res.json({ ok: true });
    }
    saveAll();
    return res.json({ ok: true });
  }

  const { to, from, subject, text, html: htmlBody } = req.body;
  if (!to || !from) {
    return res.status(400).json({ ok: false, error: "to and from required" });
  }
  const recipients = extractEmails(to);
  recipients.forEach((r) => {
    const addr = extractEmail(r);
    storeMail(addr, from, subject || "(no subject)", text || "", htmlBody || "");
  });
  saveAll();
  res.json({ ok: true });
});

function createInbox() {
  let address;
  do {
    const prefix = uuidv4().replace(/-/g, "").slice(0, 10);
    address = `${prefix}@${DOMAIN}`.toLowerCase();
  } while (inboxes.has(address));
  inboxes.set(address, []);
  inboxMeta.set(address, { note: "", password: "", createdAt: new Date().toISOString() });
  return address;
}

function generatePassword(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

function normalizeAccount(input) {
  return {
    email: extractEmail(input.email || input.address || ""),
    platform: String(input.platform || "").trim(),
    username: String(input.username || "").trim(),
    password: String(input.password || "").trim(),
    websiteUrl: String(input.websiteUrl || "").trim(),
    note: String(input.note || "").trim(),
  };
}

function getHeader(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") return headers.get(lower) || headers.get(name) || "";
  return headers[lower] || headers[name] || "";
}

function extractEmail(value) {
  const emails = extractEmails(value);
  return emails[0] || "";
}

function extractEmails(value) {
  const result = [];
  const add = (item) => {
    if (!item) return;
    if (Array.isArray(item)) {
      item.forEach(add);
      return;
    }
    if (typeof item === "object") {
      if (item.address) add(item.address);
      if (item.text) add(item.text);
      if (item.value) add(item.value);
      return;
    }
    const text = String(item);
    const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    matches.forEach((m) => result.push(m.trim().toLowerCase()));
  };
  add(value);
  return Array.from(new Set(result));
}

function collectRecipients(parsed, body) {
  const candidates = [
    ...extractEmails(body.to),
    ...extractEmails(parsed.to),
    ...extractEmails(parsed.cc),
    ...extractEmails(parsed.bcc),
    ...extractEmails(getHeader(body.headers, "to")),
    ...extractEmails(getHeader(body.headers, "delivered-to")),
    ...extractEmails(getHeader(body.headers, "x-forwarded-to")),
    ...extractEmails(getHeader(body.headers, "original-recipient")),
  ];
  if (parsed.headers && typeof parsed.headers.get === "function") {
    candidates.push(...extractEmails(parsed.headers.get("delivered-to")));
    candidates.push(...extractEmails(parsed.headers.get("x-forwarded-to")));
    candidates.push(...extractEmails(parsed.headers.get("original-recipient")));
  }
  const unique = Array.from(new Set(candidates.map(extractEmail).filter(Boolean)));
  const domain = `@${DOMAIN.toLowerCase()}`;
  const localRecipients = unique.filter((addr) => addr.endsWith(domain));
  return localRecipients.length > 0 ? localRecipients : unique;
}

function storeMail(addr, from, subject, text, html) {
  addr = extractEmail(addr);
  if (!addr) return;
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

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCodesFromText(text) {
  const source = String(text || "");
  const numeric = source.match(/\b\d{4,8}\b/g) || [];
  const values = [];
  const labelled = /(?:验证码|verification code|verify code|code)[:：\s-]{1,12}([A-Z0-9]{4,10})/gi;
  let match;
  while ((match = labelled.exec(source)) !== null) {
    values.push(match[1]);
  }
  return Array.from(new Set([...numeric, ...values].filter(Boolean))).slice(0, 8);
}

function summarizeMailbox(address, limit) {
  const mails = [...(inboxes.get(address) || [])].sort((a, b) => new Date(b.time) - new Date(a.time));
  const summaries = mails.slice(0, Math.min(Math.max(limit || 20, 1), 50)).map((mail) => {
    const plain = mail.text || stripHtml(mail.html);
    const snippet = plain.replace(/\s+/g, " ").trim().slice(0, 240);
    const codes = extractCodesFromText(`${mail.subject || ""} ${plain}`);
    return {
      id: mail.id,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      time: mail.time,
      snippet,
      codes,
    };
  });
  return {
    address,
    mailCount: mails.length,
    latestAt: mails[0]?.time || "",
    latestCodes: Array.from(new Set(summaries.flatMap((mail) => mail.codes))).slice(0, 10),
    mails: summaries,
  };
}

function extractLinksFromText(text) {
  const source = String(text || "");
  const matches = source.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/[).,;]+$/, "")))).slice(0, 20);
}

function isOpenAIMail(mail) {
  const haystack = `${mail.from || ""} ${mail.subject || ""} ${mail.text || ""} ${stripHtml(mail.html)}`.toLowerCase();
  return haystack.includes("openai") || haystack.includes("chatgpt") || haystack.includes("auth0");
}

function scanOpenAIRegistrationMailbox(address) {
  const mails = [...(inboxes.get(address) || [])].sort((a, b) => new Date(b.time) - new Date(a.time));
  const openaiMails = mails.filter(isOpenAIMail).slice(0, 10).map((mail) => {
    const plain = mail.text || stripHtml(mail.html);
    const links = extractLinksFromText(`${plain} ${mail.html || ""}`).filter((url) => {
      const lower = url.toLowerCase();
      return lower.includes("openai.com") || lower.includes("chatgpt.com") || lower.includes("auth0.com");
    });
    return {
      id: mail.id,
      from: mail.from,
      subject: mail.subject,
      time: mail.time,
      snippet: plain.replace(/\s+/g, " ").trim().slice(0, 260),
      codes: extractCodesFromText(`${mail.subject || ""} ${plain}`),
      links,
    };
  });
  return {
    email: address,
    checkedAt: new Date().toISOString(),
    mailCount: mails.length,
    openaiMailCount: openaiMails.length,
    latestCodes: Array.from(new Set(openaiMails.flatMap((mail) => mail.codes))).slice(0, 10),
    verificationLinks: Array.from(new Set(openaiMails.flatMap((mail) => mail.links))).slice(0, 10),
    mails: openaiMails,
  };
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".")) return "";
    return url.toString();
  } catch (e) {
    return "";
  }
}

async function checkWebsite(url) {
  if (!url) {
    return { ok: false, skipped: true, message: "未填写网站 URL" };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "register-health-check/1.0" },
    });
    return {
      ok: response.status >= 200 && response.status < 500,
      status: response.status,
      finalUrl: response.url,
      elapsedMs: Date.now() - started,
      message: response.status >= 200 && response.status < 400 ? "网站可访问" : "网站有响应但状态异常",
    };
  } catch (e) {
    return { ok: false, status: 0, elapsedMs: Date.now() - started, message: e.name === "AbortError" ? "访问超时" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

app.delete("/register/api/inbox/:name/mail/:id", (req, res) => {
  deleteMail(req.params.name, req.params.id, res);
});

app.get("/register/api/inbox/:name/delete/:id", (req, res) => {
  deleteMail(req.params.name, req.params.id, res);
});

function deleteMail(name, id, res) {
  const mails = inboxes.get(name);
  if (!mails) return res.json({ ok: false, error: "inbox not found" });
  const idx = mails.findIndex((m) => m.id === id);
  if (idx === -1) return res.json({ ok: false, error: "mail not found" });
  mails.splice(idx, 1);
  saveAll();
  notifySSE(name);
  res.json({ ok: true });
}

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Domain: ${DOMAIN}`);
});
