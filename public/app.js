const BASE = "/register";

let inboxes = [];
let currentAddress = null;
let currentMailId = null;
let eventSources = {};

const $ = (sel) => document.querySelector(sel);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

async function api(url, opts) {
  const r = await fetch(BASE + url, opts);
  return r.json();
}

async function loadInboxes() {
  const data = await api("/api/inbox");
  if (!data.ok) return;
  inboxes = data.list;
  renderInboxList();
}

function renderInboxList() {
  const container = $("#inboxList");
  const count = $("#inboxCount");
  container.innerHTML = "";
  count.textContent = inboxes.length;

  if (inboxes.length === 0) {
    container.innerHTML = '<div style="color:#999;padding:20px;text-align:center;font-size:13px;">暂无邮箱，点击上方按钮生成</div>';
    return;
  }

  inboxes.forEach((ib) => {
    const div = document.createElement("div");
    div.className = "inbox-item" + (ib.address === currentAddress ? " active" : "");
    const notePart = ib.note ? `备注: ${esc(ib.note)}` : "未设备注";
    const pwdPart = ib.password ? ` / 密码: ${esc(ib.password)}` : "";

    div.innerHTML = `
      <div class="inbox-addr">${esc(ib.address)}</div>
      <div class="inbox-meta">
        <span>${notePart}${pwdPart}</span>
        <span>${ib.mailCount} 封邮件</span>
      </div>
      <div class="inbox-actions">
        <button class="btn-edit">编辑信息</button>
        <button class="btn-delete-inbox">删除</button>
      </div>
    `;

    if (ib.mailCount > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = ib.mailCount;
      div.appendChild(badge);
    }

    div.querySelector(".inbox-addr").onclick = () => selectInbox(ib.address);
    div.querySelector(".btn-edit").onclick = (e) => { e.stopPropagation(); openEditModal(ib.address); };
    div.querySelector(".btn-delete-inbox").onclick = (e) => { e.stopPropagation(); deleteInbox(ib.address); };

    container.appendChild(div);
  });
}

function selectInbox(address) {
  currentAddress = address;
  currentMailId = null;

  hide($("#emptyHint"));
  show($("#mainLayout"));
  hide($("#detailHeader"));
  hide($("#detailBody"));
  hide($("#btnDeleteMail"));

  subscribeSSE(address);
  loadMailList(address);
  renderInboxList();
}

function subscribeSSE(address) {
  if (!eventSources[address]) {
    const es = new EventSource(BASE + "/api/stream/" + encodeURIComponent(address));
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const ib = inboxes.find((x) => x.address === address);
      if (ib) ib.mailCount = data.mails.length;
      if (address === currentAddress) {
        renderMailList(data.mails);
      }
      renderInboxList();
    };
    es.onerror = () => {
      es.close();
      delete eventSources[address];
    };
    eventSources[address] = es;
  }
}

async function loadMailList(address) {
  const data = await api("/api/inbox/" + encodeURIComponent(address));
  if (data.ok) {
    renderMailList(data.list);
  }
}

function renderMailList(list) {
  const panel = $("#mailPanel");

  let existing = panel.querySelector(".mail-sub-list");
  if (!existing) {
    existing = document.createElement("div");
    existing.className = "mail-sub-list";
    existing.style.cssText = "margin-bottom:14px;";
    const ref = panel.querySelector(".detail-body") || panel.lastElementChild;
    panel.insertBefore(existing, ref);
  }
  const container = existing;

  if (!list || list.length === 0) {
    container.innerHTML = '<div style="color:#999;padding:20px;text-align:center;font-size:13px;">暂无邮件</div>';
    return;
  }

  container.innerHTML = "";
  list.forEach((m) => {
    const div = document.createElement("div");
    div.className = "mail-item" + (m.id === currentMailId ? " active" : "");
    div.style.cssText = "padding:10px 8px;border-bottom:1px solid #eee;cursor:pointer;border-radius:4px;";
    div.onmouseover = () => { div.style.background = "#f5f7fa"; };
    div.onmouseout = () => { div.style.background = m.id === currentMailId ? "#e8f0fe" : "transparent"; };
    if (m.id === currentMailId) div.style.background = "#e8f0fe";

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:500;">${esc(m.from)}</span>
        <span style="font-size:11px;color:#999;">${fmtTime(m.time)}</span>
      </div>
      <div style="font-size:12px;color:#666;margin-top:2px;">${esc(m.subject)}</div>
    `;
    div.onclick = () => viewMail(m.id);
    container.appendChild(div);
  });
}

async function viewMail(id) {
  if (!currentAddress) return;
  currentMailId = id;
  show($("#detailHeader"));
  show($("#detailBody"));
  show($("#btnDeleteMail"));

  const data = await api("/api/inbox/" + encodeURIComponent(currentAddress) + "/" + id);
  if (!data.ok) return;
  const m = data.mail;

  $("#detailAddress").textContent = currentAddress;
  $("#detailSubject").textContent = m.subject;
  $("#detailFrom").textContent = m.from;
  $("#detailTime").textContent = fmtTime(m.time);

  const frame = $("#detailFrame");
  frame.srcdoc = m.html || "<pre>" + esc(m.text || "") + "</pre>";

  renderInboxList();
}

async function deleteMail() {
  if (!currentAddress || !currentMailId) return;
  if (!confirm("确定删除此邮件？")) return;

  const data = await api(
    "/api/inbox/" + encodeURIComponent(currentAddress) + "/delete/" + currentMailId
  );
  if (data.ok) {
    currentMailId = null;
    hide($("#detailHeader"));
    hide($("#detailBody"));
    hide($("#btnDeleteMail"));
    loadMailList(currentAddress);
  }
}

async function deleteInbox(address) {
  if (!confirm("确定删除邮箱 " + address + " 及其所有邮件？")) return;

  const data = await api("/api/inbox/" + encodeURIComponent(address), { method: "DELETE" });
  if (data.ok) {
    if (eventSources[address]) {
      eventSources[address].close();
      delete eventSources[address];
    }
    if (currentAddress === address) {
      currentAddress = null;
      currentMailId = null;
      hide($("#detailHeader"));
      hide($("#detailBody"));
      hide($("#btnDeleteMail"));
    }
    loadInboxes();
    toast("已删除 " + address);
  }
}

function openEditModal(address) {
  const ib = inboxes.find((x) => x.address === address);
  if (!ib) return;
  $("#editEmail").textContent = address;
  $("#editNote").value = ib.note || "";
  $("#editPassword").value = ib.password || "";
  show($("#editModal"));
  $("#editModal").dataset.address = address;
}

async function saveMeta() {
  const address = $("#editModal").dataset.address;
  const note = $("#editNote").value;
  const password = $("#editPassword").value;

  const data = await api("/api/inbox/" + encodeURIComponent(address) + "/meta", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, password }),
  });
  if (data.ok) {
    hide($("#editModal"));
    loadInboxes();
    toast("已保存");
  }
}

async function doCreate(count) {
  const data = await api("/api/inbox/create-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  if (data.ok && data.addresses.length > 0) {
    await loadInboxes();
    selectInbox(data.addresses[data.addresses.length - 1]);
    toast(`已生成 ${data.addresses.length} 个邮箱`);
  }
}

function esc(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtTime(t) {
  if (!t) return "";
  try { return new Date(t).toLocaleString("zh-CN"); } catch (e) { return t; }
}

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "create") doCreate(1);
    if (action === "create5") doCreate(5);
    if (action === "create10") doCreate(10);
    if (action === "createN") doCreate(parseInt($("#batchCount").value) || 1);
  });
});

$("#btnSaveMeta").addEventListener("click", saveMeta);
$("#btnCancelEdit").addEventListener("click", () => hide($("#editModal")));
$("#btnDeleteMail").addEventListener("click", deleteMail);

loadInboxes();
