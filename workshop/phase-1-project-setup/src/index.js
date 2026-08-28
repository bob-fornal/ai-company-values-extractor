/**
 * Company Values Extractor — Cloudflare Worker + Workers AI
 * PHASE 1: Project setup & health check
 *
 * Endpoints
 * ---------
 *   GET  /   → health check / usage instructions
 *
 * This phase has no AI or crawling logic yet — just enough scaffolding to
 * deploy a Worker, understand wrangler.toml, and add a routed endpoint.
 * Later phases build on this file directly.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return handleHealth();
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse({ error: "Internal server error", detail: err.message }, 500);
    }
  },
};

function handleHealth() {
  return jsonResponse({
    service: "Company Values Extractor",
    status: "ok",
    phase: 1,
    endpoints: {
      "GET /": "Health check and usage info",
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
