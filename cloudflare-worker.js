export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();
    const parsed = parseEmail(raw);

    const body = {
      to: parsed.to,
      from: parsed.from,
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.html,
    };

    const target = env.WEBHOOK_URL || "http://lshang.top:5454/register/webhook/mail";

    try {
      await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("Webhook failed:", e.message);
    }
  },
};

function parseEmail(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return { to: "", from: "", subject: "", text: raw, html: "" };
  }

  const header = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd + 4);

  const to = getHeader(header, "to");
  const from = getHeader(header, "from");
  const subject = decodeHeader(getHeader(header, "subject"));

  let text = "";
  let html = "";

  const contentType = getHeader(header, "content-type") || "";
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;

  if (boundary) {
    const parts = body.split("--" + boundary);
    for (const part of parts) {
      const sep = part.indexOf("\r\n\r\n");
      if (sep === -1) continue;
      const ph = part.slice(0, sep);
      const pb = part.slice(sep + 4).replace(/\r\n--$/, "");
      if (ph.includes("text/plain") && !ph.includes("attachment")) {
        text = decodeQuotedPrintable(pb, ph);
      } else if (ph.includes("text/html") && !ph.includes("attachment")) {
        html = decodeQuotedPrintable(pb, ph);
      }
    }
  } else {
    const enc = (contentType.match(/charset="?([^";\s]+)"?/i) || [])[1];
    const cte = (getHeader(header, "content-transfer-encoding") || "").toLowerCase();
    if (cte === "base64") {
      try {
        const decoded = atob(body.replace(/\s/g, ""));
        const buf = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) buf[i] = decoded.charCodeAt(i);
        const txt = new TextDecoder(enc || "utf-8").decode(buf);
        if (contentType.includes("text/html")) {
          html = txt;
        } else {
          text = txt;
        }
      } catch (e) {
        text = body;
      }
    } else {
      if (contentType.includes("text/html")) {
        html = body;
      } else {
        text = body;
      }
    }
  }

  return { to, from, subject, text, html };
}

function getHeader(header, name) {
  const re = new RegExp("^" + name + ":[ \\t]*([^\\r\\n]+)", "im");
  const m = header.match(re);
  return m ? m[1].trim() : "";
}

function decodeHeader(val) {
  return val
    .replace(/=\?UTF-8\?B\?(.*?)\?=/gi, (_, s) => {
      try {
        return atob(s);
      } catch (e) {
        return s;
      }
    })
    .replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, s) => {
      return s
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
    });
}

function decodeQuotedPrintable(str, headers) {
  const encMatch = (headers || "").match(/charset="?([^";\s]+)"?/i);
  const enc = encMatch ? encMatch[1] : "utf-8";
  const cte = (headers.match(/Content-Transfer-Encoding:\s*(\S+)/i) || [])[1];

  if (cte && cte.toLowerCase() === "base64") {
    try {
      const b64 = str.replace(/\s/g, "");
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder(enc).decode(bytes);
    } catch (e) {
      return str;
    }
  }

  let result = str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

  try {
    const bytes = new TextEncoder().encode(result);
    result = new TextDecoder(enc).decode(bytes);
  } catch (e) {}

  return result;
}
