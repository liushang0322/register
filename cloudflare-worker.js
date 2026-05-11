export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();
    const headers = {};
    for (const [key, value] of message.headers) {
      headers[key.toLowerCase()] = value;
    }

    const body = {
      raw,
      from: message.from,
      to: message.to,
      headers,
    };

    const target = env.WEBHOOK_URL || "http://lshang.top/register/webhook/mail";

    try {
      const resp = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      console.log("Webhook response:", resp.status, await resp.text());
    } catch (e) {
      console.error("Webhook failed:", e.message);
    }
  },
};
