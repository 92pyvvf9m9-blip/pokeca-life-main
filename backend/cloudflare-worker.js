/**
 * Pokeca Life feed API starter.
 *
 * Bind a KV namespace as LOTTERY_FEED and store JSON at key "current".
 * GET /feed returns the shared lottery feed consumed by the app.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "pokeca-life-feed" });
    }

    if (url.pathname === "/feed") {
      const raw = await env.LOTTERY_FEED.get("current");
      const payload = raw
        ? JSON.parse(raw)
        : { version: 1, updatedAt: new Date().toISOString(), lotteries: [] };
      return json(payload);
    }

    return json({ error: "Not found" }, 404);
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}
