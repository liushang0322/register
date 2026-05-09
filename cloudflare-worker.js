export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();
    const body = { raw };

    const target = "http://lshang.top/register/webhook/mail";

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
