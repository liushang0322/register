const BASE = "";

let inboxes = [];
let accounts = [];
let registrationJobs = [];
let currentAddress = "";
let currentMailId = "";
let currentMails = [];
let currentStream = null;

const $ = (sel) => document.querySelector(sel);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function toast(message, type = "ok") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  document.body.appendChild(item);
  setTimeout(() => item.remove(), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(BASE + url, options);
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = { ok: false, error: "服务返回格式错误" };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

async function loadAll() {
  await Promise.all([loadInboxes(), loadAccounts(), loadRegistrationJobs()]);
}

async function loadInboxes() {
  const data = await api("/api/inbox");
  inboxes = data.list || [];
  renderInboxList();
  renderSelectedPanel();
}

async function loadAccounts() {
  const data = await api("/api/accounts");
  accounts = data.list || [];
  renderAccountList();
}

async function loadRegistrationJobs() {
  const data = await api("/api/register-jobs");
  registrationJobs = data.list || [];
  renderRegistrationJobs();
}

function renderInboxList() {
  const container = $("#inboxList");
  const keyword = $("#inboxSearch").value.trim().toLowerCase();
  const filtered = inboxes.filter((item) => {
    const text = `${item.address} ${item.note || ""} ${item.password || ""}`.toLowerCase();
    return !keyword || text.includes(keyword);
  });

  $("#inboxCount").textContent = inboxes.length;
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-inline">暂无邮箱</div>';
    return;
  }

  filtered.forEach((inbox) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "inbox-item" + (inbox.address === currentAddress ? " active" : "");
    item.innerHTML = `
      <span class="inbox-address">${esc(inbox.address)}</span>
      <span class="inbox-info">
        <span>${esc(inbox.note || "未设置备注")}</span>
        <span>${inbox.mailCount || 0} 封邮件</span>
      </span>
    `;
    item.addEventListener("click", () => selectInbox(inbox.address));
    container.appendChild(item);
  });
}

function renderSelectedPanel() {
  const inbox = getCurrentInbox();
  $("#selectedAddress").textContent = inbox ? inbox.address : "请选择或生成邮箱";
  $("#selectedMeta").textContent = inbox ? [inbox.note, inbox.password ? `密码：${inbox.password}` : ""].filter(Boolean).join(" / ") : "";
  $("#btnCopyAddress").disabled = !inbox;
  $("#btnFetchMailbox").disabled = !inbox;
  $("#btnEditInbox").disabled = !inbox;
  $("#btnDeleteInbox").disabled = !inbox;
  if (inbox && !$("#accountId").value) $("#accountEmail").value = inbox.address;
}

function renderAccountList() {
  const container = $("#accountList");
  const list = currentAddress ? accounts.filter((item) => item.email === currentAddress) : accounts;
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-inline">暂无账号记录</div>';
    return;
  }

  list.forEach((account) => {
    const check = account.lastCheck;
    const siteLabel = check?.site?.skipped ? "未检测网站" : check?.site?.ok ? "网站可访问" : check ? "网站异常" : "未检测";
    const mailLabel = check?.mailbox ? `${check.mailbox.mailCount} 封邮件` : "未抓取";
    const codes = check?.mailbox?.latestCodes?.length ? `验证码：${check.mailbox.latestCodes.join(", ")}` : "";

    const item = document.createElement("div");
    item.className = "account-item";
    item.innerHTML = `
      <div>
        <strong>${esc(account.platform || "未命名平台")}</strong>
        <span>${esc(account.email)}</span>
        <span>${esc(account.websiteUrl || "")}</span>
      </div>
      <div>
        <span>账号：${esc(account.username || "-")}</span>
        <span>密码：${esc(account.password || "-")}</span>
        <span>姓名：${esc(account.fullName || "-")}</span>
        <span>年龄：${esc(account.age || "-")}</span>
      </div>
      <p>${esc(account.note || "")}</p>
      <div class="check-summary">
        <span>${esc(siteLabel)}</span>
        <span>${esc(mailLabel)}</span>
        <span>${esc(codes)}</span>
      </div>
      <div class="row-actions">
        <button type="button" class="btn-small" data-action="check">检测</button>
        <button type="button" class="btn-small" data-action="edit">编辑</button>
        <button type="button" class="btn-small danger" data-action="delete">删除</button>
      </div>
    `;
    item.querySelector('[data-action="check"]').addEventListener("click", () => checkAccount(account.id));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => editAccount(account.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAccount(account.id));
    container.appendChild(item);
  });
}

function renderRegistrationJobs() {
  const container = $("#registrationJobList");
  container.innerHTML = "";

  if (registrationJobs.length === 0) {
    container.innerHTML = '<div class="empty-inline">暂无 OpenAI 注册任务</div>';
    return;
  }

  registrationJobs.forEach((job) => {
    const scan = job.lastScan;
    const statusText = {
      pending: "待注册",
      mail_received: "已收到邮件",
      completed: "已完成",
      paused: "已暂停",
    }[job.status] || job.status || "待注册";
    const codes = scan?.latestCodes?.length ? scan.latestCodes.join(", ") : "未发现";
    const links = scan?.verificationLinks || [];
    const item = document.createElement("div");
    item.className = "registration-job";
    item.innerHTML = `
      <div class="job-main">
        <strong>${esc(job.product === "api" ? "OpenAI API" : "OpenAI ChatGPT")}</strong>
        <span>${esc(job.email)}</span>
        <span>密码：${esc(job.password)}</span>
        <span>姓名：${esc(job.fullName || "-")}</span>
        <span>年龄：${esc(job.age || "-")}</span>
        <span>状态：${esc(statusText)}</span>
      </div>
      <div class="job-scan">
        <span>OpenAI 邮件：${scan ? scan.openaiMailCount : 0} / 总邮件：${scan ? scan.mailCount : 0}</span>
        <span>验证码：${esc(codes)}</span>
        ${links.length ? `<a href="${esc(links[0])}" target="_blank" rel="noopener">打开验证链接</a>` : ""}
      </div>
      <div class="job-actions">
        <a class="btn-small link-btn" href="${esc(job.websiteUrl)}" target="_blank" rel="noopener">打开注册页</a>
        <button type="button" class="btn-small" data-action="copy-email">复制邮箱</button>
        <button type="button" class="btn-small" data-action="copy-password">复制密码</button>
        <button type="button" class="btn-small" data-action="copy-name">复制姓名</button>
        <button type="button" class="btn-small" data-action="scan">扫描邮件</button>
        <button type="button" class="btn-small" data-action="complete">标记成功并保存</button>
        <button type="button" class="btn-small danger" data-action="delete">删除任务</button>
      </div>
    `;
    item.querySelector('[data-action="copy-email"]').addEventListener("click", () => copyText(job.email, "邮箱已复制"));
    item.querySelector('[data-action="copy-password"]').addEventListener("click", () => copyText(job.password, "密码已复制"));
    item.querySelector('[data-action="copy-name"]').addEventListener("click", () => copyText(job.fullName || "", "姓名已复制"));
    item.querySelector('[data-action="scan"]').addEventListener("click", () => scanRegistrationJob(job.id));
    item.querySelector('[data-action="complete"]').addEventListener("click", () => completeRegistrationJob(job.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteRegistrationJob(job.id));
    container.appendChild(item);
  });
}

function renderMailList(list = currentMails) {
  currentMails = [...list].sort((a, b) => new Date(b.time) - new Date(a.time));
  const container = $("#mailList");
  container.innerHTML = "";
  $("#mailStatus").textContent = currentAddress ? `${currentMails.length} 封邮件` : "未选择邮箱";

  if (!currentAddress) {
    container.innerHTML = '<div class="empty-inline">先选择一个邮箱</div>';
    return;
  }
  if (currentMails.length === 0) {
    container.innerHTML = '<div class="empty-inline">暂无邮件，收到新邮件会自动刷新</div>';
    return;
  }

  currentMails.forEach((mail) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mail-item" + (mail.id === currentMailId ? " active" : "");
    const codeLine = mail.codes && mail.codes.length ? `<span class="mail-code">验证码：${esc(mail.codes.join(", "))}</span>` : "";
    item.innerHTML = `
      <span class="mail-from">${esc(mail.from || "")}</span>
      <span class="mail-subject">${esc(mail.subject || "(无主题)")}</span>
      ${codeLine}
      <span class="mail-time">${fmtTime(mail.time)}</span>
    `;
    item.addEventListener("click", () => viewMail(mail.id));
    container.appendChild(item);
  });
}

function renderDiagnostic(title, rows) {
  $("#diagnosticResult").innerHTML = `
    <div class="diagnostic-title">${esc(title)}</div>
    <div class="diagnostic-grid">
      ${rows.map((row) => `
        <div class="diagnostic-row ${row.ok ? "ok" : "bad"}">
          <strong>${esc(row.name)}</strong>
          <span>${row.ok ? "正常" : "异常"}</span>
          <p>${esc(row.message || "")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

async function selectInbox(address) {
  currentAddress = address;
  currentMailId = "";
  currentMails = [];
  resetMailDetail();
  renderInboxList();
  renderSelectedPanel();
  renderAccountList();
  subscribeSSE(address);

  try {
    const data = await api(`/api/inbox/${encodeURIComponent(address)}`);
    renderMailList(data.list || []);
  } catch (e) {
    toast(e.message, "error");
  }
}

function subscribeSSE(address) {
  if (currentStream) currentStream.close();
  currentStream = new EventSource(`${BASE}/api/stream/${encodeURIComponent(address)}`);
  currentStream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.address !== currentAddress) return;
    const inbox = inboxes.find((item) => item.address === data.address);
    if (inbox) inbox.mailCount = data.mails.length;
    renderInboxList();
    renderMailList(data.mails || []);
  };
  currentStream.onerror = () => {
    currentStream.close();
    currentStream = null;
  };
}

async function viewMail(id) {
  currentMailId = id;
  renderMailList();

  try {
    const data = await api(`/api/inbox/${encodeURIComponent(currentAddress)}/${encodeURIComponent(id)}`);
    const mail = data.mail;
    $("#detailAddress").textContent = mail.to || currentAddress;
    $("#detailSubject").textContent = mail.subject || "(无主题)";
    $("#detailFrom").textContent = mail.from || "";
    $("#detailTime").textContent = fmtTime(mail.time);
    $("#detailFrame").srcdoc = mail.html || `<pre>${esc(mail.text || "")}</pre>`;
    show($("#detailHeader"));
    show($("#detailFrame"));
    hide($("#detailEmpty"));
  } catch (e) {
    toast(e.message, "error");
  }
}

function resetMailDetail() {
  hide($("#detailHeader"));
  hide($("#detailFrame"));
  show($("#detailEmpty"));
  $("#detailFrame").srcdoc = "";
}

async function createInboxes(count) {
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 1, 1), 50);
  try {
    const data = await api("/api/inbox/create-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: safeCount }),
    });
    await loadInboxes();
    if (data.addresses && data.addresses.length > 0) {
      await selectInbox(data.addresses[data.addresses.length - 1]);
    }
    toast(`已生成 ${data.addresses.length} 个邮箱`);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function runHealthCheck() {
  try {
    const data = await api("/api/health");
    renderDiagnostic("系统检测", data.checks.map((item) => ({
      name: item.name,
      ok: item.ok,
      message: item.message,
    })));
  } catch (e) {
    renderDiagnostic("系统检测", [{ name: "health", ok: false, message: e.message }]);
  }
}

async function runMailCaptureTest() {
  try {
    const data = await api("/api/diagnostics/mail-capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await loadInboxes();
    renderDiagnostic("收信和抓取检测", [
      ...data.checks,
      { name: "testInbox", ok: true, message: data.address },
      { name: "capturedCode", ok: data.mailbox.latestCodes.includes(data.injectedCode), message: data.injectedCode },
    ]);
    await selectInbox(data.address);
    toast("收信和抓取检测完成");
  } catch (e) {
    renderDiagnostic("收信和抓取检测", [{ name: "mailCapture", ok: false, message: e.message }]);
  }
}

async function createOpenAIJob(product) {
  try {
    const websiteUrl = $("#openaiSignupUrl").value.trim();
    const data = await api("/api/register-jobs/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, websiteUrl }),
    });
    await loadAll();
    await selectInbox(data.job.email);
    renderDiagnostic("OpenAI 注册任务", [
      { name: "email", ok: true, message: data.job.email },
      { name: "password", ok: true, message: data.job.password },
      { name: "fullName", ok: true, message: data.job.fullName || "" },
      { name: "age", ok: true, message: String(data.job.age || "") },
      { name: "registerUrl", ok: true, message: data.job.websiteUrl },
    ]);
    toast("OpenAI 注册任务已创建");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function scanRegistrationJob(id) {
  try {
    const data = await api(`/api/register-jobs/${encodeURIComponent(id)}/scan`, { method: "POST" });
    await loadRegistrationJobs();
    await loadInboxes();
    if (data.job.email) {
      await selectInbox(data.job.email);
    }
    renderDiagnostic("OpenAI 邮件扫描", [
      { name: "mailbox", ok: true, message: data.scan.email },
      { name: "openaiMail", ok: data.scan.openaiMailCount > 0, message: `${data.scan.openaiMailCount} 封 OpenAI 相关邮件` },
      { name: "codes", ok: data.scan.latestCodes.length > 0, message: data.scan.latestCodes.join(", ") || "未发现验证码" },
      { name: "links", ok: data.scan.verificationLinks.length > 0, message: data.scan.verificationLinks[0] || "未发现验证链接" },
    ]);
    toast("OpenAI 邮件扫描完成");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function completeRegistrationJob(id) {
  if (!confirm("确认你已经在 OpenAI 官方页面完成注册？确认后会保存到账号管理。")) return;
  try {
    const data = await api(`/api/register-jobs/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "OpenAI 注册成功" }),
    });
    await loadAll();
    renderDiagnostic("OpenAI 账号已保存", [
      { name: "platform", ok: true, message: data.account.platform },
      { name: "email", ok: true, message: data.account.email },
      { name: "website", ok: true, message: data.account.websiteUrl },
    ]);
    toast("账号已保存到账号管理");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteRegistrationJob(id) {
  if (!confirm("确定删除这个注册任务？已保存的账号记录不会被删除。")) return;
  try {
    await api(`/api/register-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadRegistrationJobs();
    toast("注册任务已删除");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function fetchCurrentMailbox() {
  if (!currentAddress) return;
  try {
    const data = await api(`/api/inbox/${encodeURIComponent(currentAddress)}/mail-content?limit=20`);
    renderMailList(data.mailbox.mails || []);
    renderDiagnostic("邮箱内容抓取", [
      { name: "mailbox", ok: true, message: currentAddress },
      { name: "mailCount", ok: true, message: `${data.mailbox.mailCount} 封邮件` },
      { name: "codeExtract", ok: data.mailbox.latestCodes.length > 0, message: data.mailbox.latestCodes.join(", ") || "未发现验证码" },
    ]);
    toast("邮箱内容已抓取");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function checkAccount(id) {
  const account = accounts.find((item) => item.id === id);
  if (!account) return;
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(id)}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl: account.websiteUrl }),
    });
    await loadAccounts();
    if (data.account.email) {
      currentAddress = data.account.email;
      await loadInboxes();
      renderSelectedPanel();
      renderMailList(data.mails || []);
    }
    renderDiagnostic(`账号检测：${data.account.platform || data.account.email}`, [
      { name: "site", ok: data.result.site.ok || data.result.site.skipped, message: data.result.site.message },
      { name: "mailbox", ok: data.result.mailbox.ok, message: `${data.result.mailbox.mailCount} 封邮件` },
      { name: "codes", ok: data.result.mailbox.latestCodes.length > 0, message: data.result.mailbox.latestCodes.join(", ") || "未发现验证码" },
    ]);
    toast("账号检测完成");
  } catch (e) {
    toast(e.message, "error");
  }
}

function openEditModal() {
  const inbox = getCurrentInbox();
  if (!inbox) return;
  $("#editEmail").textContent = inbox.address;
  $("#editNote").value = inbox.note || "";
  $("#editPassword").value = inbox.password || "";
  $("#editModal").dataset.address = inbox.address;
  show($("#editModal"));
}

async function saveInboxMeta() {
  const address = $("#editModal").dataset.address;
  try {
    await api(`/api/inbox/${encodeURIComponent(address)}/meta`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: $("#editNote").value,
        password: $("#editPassword").value,
      }),
    });
    hide($("#editModal"));
    await loadInboxes();
    toast("邮箱信息已保存");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteCurrentInbox() {
  if (!currentAddress) return;
  if (!confirm(`确定删除 ${currentAddress} 及其所有邮件和账号记录？`)) return;
  try {
    await api(`/api/inbox/${encodeURIComponent(currentAddress)}`, { method: "DELETE" });
    if (currentStream) currentStream.close();
    currentAddress = "";
    currentMailId = "";
    currentMails = [];
    resetMailDetail();
    await loadAll();
    renderMailList([]);
    toast("邮箱已删除");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteCurrentMail() {
  if (!currentAddress || !currentMailId) return;
  if (!confirm("确定删除这封邮件？")) return;
  try {
    await api(`/api/inbox/${encodeURIComponent(currentAddress)}/mail/${encodeURIComponent(currentMailId)}`, { method: "DELETE" });
    currentMailId = "";
    resetMailDetail();
    await selectInbox(currentAddress);
    toast("邮件已删除");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function saveAccount(event) {
  event.preventDefault();
  const id = $("#accountId").value;
  const payload = {
    email: $("#accountEmail").value,
    platform: $("#accountPlatform").value,
    websiteUrl: $("#accountWebsiteUrl").value,
    username: $("#accountUsername").value,
    password: $("#accountPassword").value,
    fullName: $("#accountFullName").value,
    age: $("#accountAge").value,
    note: $("#accountNote").value,
  };
  const url = id ? `/api/accounts/${encodeURIComponent(id)}` : "/api/accounts";
  const method = id ? "PUT" : "POST";

  try {
    await api(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    resetAccountForm();
    await loadAccounts();
    toast("账号记录已保存");
  } catch (e) {
    toast(e.message, "error");
  }
}

function editAccount(id) {
  const account = accounts.find((item) => item.id === id);
  if (!account) return;
  $("#accountId").value = account.id;
  $("#accountEmail").value = account.email || "";
  $("#accountPlatform").value = account.platform || "";
  $("#accountWebsiteUrl").value = account.websiteUrl || "";
  $("#accountUsername").value = account.username || "";
  $("#accountPassword").value = account.password || "";
  $("#accountFullName").value = account.fullName || "";
  $("#accountAge").value = account.age || "";
  $("#accountNote").value = account.note || "";
}

async function deleteAccount(id) {
  if (!confirm("确定删除这条账号记录？")) return;
  try {
    await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadAccounts();
    toast("账号记录已删除");
  } catch (e) {
    toast(e.message, "error");
  }
}

function resetAccountForm() {
  $("#accountId").value = "";
  $("#accountEmail").value = currentAddress || "";
  $("#accountPlatform").value = "";
  $("#accountWebsiteUrl").value = "";
  $("#accountUsername").value = "";
  $("#accountPassword").value = "";
  $("#accountFullName").value = "";
  $("#accountAge").value = "";
  $("#accountNote").value = "";
}

function getCurrentInbox() {
  return inboxes.find((item) => item.address === currentAddress);
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch (e) {
    return value;
  }
}

async function copyText(value, message) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast(message);
  } catch (e) {
    toast("复制失败，请手动复制", "error");
  }
}

document.querySelectorAll("[data-create]").forEach((button) => {
  button.addEventListener("click", () => createInboxes(button.dataset.create));
});

$("#btnCreateBatch").addEventListener("click", () => createInboxes($("#batchCount").value));
$("#btnRefresh").addEventListener("click", () => loadAll().catch((e) => toast(e.message, "error")));
$("#btnHealthCheck").addEventListener("click", runHealthCheck);
$("#btnMailCaptureTest").addEventListener("click", runMailCaptureTest);
$("#btnFetchMailbox").addEventListener("click", fetchCurrentMailbox);
$("#btnCreateOpenAIChatGPT").addEventListener("click", () => createOpenAIJob("chatgpt"));
$("#btnCreateOpenAIAPI").addEventListener("click", () => createOpenAIJob("api"));
$("#inboxSearch").addEventListener("input", renderInboxList);
$("#btnCopyAddress").addEventListener("click", async () => {
  if (!currentAddress) return;
  copyText(currentAddress, "邮箱已复制");
});
$("#btnEditInbox").addEventListener("click", openEditModal);
$("#btnDeleteInbox").addEventListener("click", deleteCurrentInbox);
$("#btnSaveMeta").addEventListener("click", saveInboxMeta);
$("#btnCancelEdit").addEventListener("click", () => hide($("#editModal")));
$("#btnDeleteMail").addEventListener("click", deleteCurrentMail);
$("#accountForm").addEventListener("submit", saveAccount);
$("#btnResetAccount").addEventListener("click", resetAccountForm);

loadAll()
  .then(() => renderMailList([]))
  .catch((e) => toast(e.message, "error"));
