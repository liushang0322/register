const BASE = "/register";

let inboxes = [];
let accounts = [];
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
  await Promise.all([loadInboxes(), loadAccounts()]);
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
    const item = document.createElement("div");
    item.className = "account-item";
    item.innerHTML = `
      <div>
        <strong>${esc(account.platform || "未命名平台")}</strong>
        <span>${esc(account.email)}</span>
      </div>
      <div>
        <span>账号：${esc(account.username || "-")}</span>
        <span>密码：${esc(account.password || "-")}</span>
      </div>
      <p>${esc(account.note || "")}</p>
      <div class="row-actions">
        <button type="button" class="btn-small" data-action="edit">编辑</button>
        <button type="button" class="btn-small danger" data-action="delete">删除</button>
      </div>
    `;
    item.querySelector('[data-action="edit"]').addEventListener("click", () => editAccount(account.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAccount(account.id));
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
    item.innerHTML = `
      <span class="mail-from">${esc(mail.from || "")}</span>
      <span class="mail-subject">${esc(mail.subject || "(无主题)")}</span>
      <span class="mail-time">${fmtTime(mail.time)}</span>
    `;
    item.addEventListener("click", () => viewMail(mail.id));
    container.appendChild(item);
  });
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
    username: $("#accountUsername").value,
    password: $("#accountPassword").value,
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
  $("#accountUsername").value = account.username || "";
  $("#accountPassword").value = account.password || "";
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
  $("#accountUsername").value = "";
  $("#accountPassword").value = "";
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

document.querySelectorAll("[data-create]").forEach((button) => {
  button.addEventListener("click", () => createInboxes(button.dataset.create));
});

$("#btnCreateBatch").addEventListener("click", () => createInboxes($("#batchCount").value));
$("#btnRefresh").addEventListener("click", () => loadAll().catch((e) => toast(e.message, "error")));
$("#inboxSearch").addEventListener("input", renderInboxList);
$("#btnCopyAddress").addEventListener("click", async () => {
  if (!currentAddress) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(currentAddress);
    } else {
      const input = document.createElement("textarea");
      input.value = currentAddress;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast("邮箱已复制");
  } catch (e) {
    toast("复制失败，请手动复制", "error");
  }
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
