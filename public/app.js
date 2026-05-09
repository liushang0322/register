const BASE = "/register";

let currentAddress = null;
let currentMailId = null;
let eventSource = null;

const $ = (sel) => document.querySelector(sel);

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

function clearInboxUI() {
  $("#mailList").innerHTML = "";
  hide($("#sidebar"));
  hide($("#mailDetail"));
  show($("#emptyHint"));
}

function createInbox() {
  fetch(BASE + "/api/inbox/create", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) return;
      selectInbox(data.address);
    });
}

function selectInbox(address) {
  currentAddress = address;
  currentMailId = null;

  hide($("#emptyHint"));
  show($("#currentEmail"));
  show($("#sidebar"));
  hide($("#mailDetail"));
  $("#emailText").textContent = address;

  if (eventSource) eventSource.close();
  eventSource = new EventSource(BASE + "/api/stream/" + encodeURIComponent(address));
  eventSource.onmessage = (e) => {
    const mails = JSON.parse(e.data);
    renderMailList(mails);
  };
  eventSource.onerror = () => {
    eventSource.close();
    eventSource = new EventSource(BASE + "/api/stream/" + encodeURIComponent(address));
  };

  fetch(BASE + "/api/inbox/" + encodeURIComponent(address))
    .then((r) => r.json())
    .then((data) => {
      if (data.ok) renderMailList(data.list);
    });
}

function renderMailList(list) {
  const container = $("#mailList");
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerHTML = '<div class="mail-item" style="color:#999;cursor:default;">暂无邮件</div>';
    return;
  }

  list.forEach((m) => {
    const div = document.createElement("div");
    div.className = "mail-item" + (m.id === currentMailId ? " active" : "");
    div.innerHTML = `
      <div class="item-from">${esc(m.from)}</div>
      <div class="item-subject">${esc(m.subject)}</div>
      <div class="item-time">${fmtTime(m.time)}</div>
    `;
    div.onclick = () => viewMail(m.id);
    container.appendChild(div);
  });
}

function viewMail(id) {
  if (!currentAddress) return;
  currentMailId = id;
  show($("#mailDetail"));

  fetch(BASE + "/api/inbox/" + encodeURIComponent(currentAddress) + "/" + id)
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) return;
      const m = data.mail;
      $("#detailSubject").textContent = m.subject;
      $("#detailFrom").textContent = m.from;
      $("#detailTime").textContent = fmtTime(m.time);

      const frame = $("#detailFrame");
      const content = m.html || "<pre>" + esc(m.text || "") + "</pre>";
      frame.srcdoc = content;
    });

  const items = document.querySelectorAll(".mail-item");
  items.forEach((el) => el.classList.remove("active"));
  const target = Array.from(items).find(
    (el) => el.querySelector(".item-subject") && el.onclick
  );
}

function deleteMail() {
  if (!currentAddress || !currentMailId) return;
  if (!confirm("确定删除此邮件？")) return;

  fetch(
    BASE +
      "/api/inbox/" +
      encodeURIComponent(currentAddress) +
      "/delete/" +
      currentMailId
  )
    .then((r) => r.json())
    .then((data) => {
      if (data.ok) {
        currentMailId = null;
        hide($("#mailDetail"));
      }
    });
}

function copyEmail() {
  const text = $("#emailText").textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = $("#btnCopy");
    btn.textContent = "已复制!";
    setTimeout(() => (btn.textContent = "复制"), 1500);
  });
}

function esc(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtTime(t) {
  if (!t) return "";
  try {
    return new Date(t).toLocaleString("zh-CN");
  } catch (e) {
    return t;
  }
}

$("#btnCreate").addEventListener("click", createInbox);
$("#btnCopy").addEventListener("click", copyEmail);
$("#btnDelete").addEventListener("click", deleteMail);
