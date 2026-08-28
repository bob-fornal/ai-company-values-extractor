/**
 * Company Values Extractor — Cloudflare Worker + Workers AI
 * PHASE 2: Crawling & AI extraction
 *
 * Endpoints
 * ---------
 *   GET  /         → health check / usage instructions
 *   POST /extract   → extract structured values from a company website
 *
 * New this phase: a fixed list of candidate pages is fetched with a plain
 * fetch(), combined into one text blob, and sent to Workers AI for
 * structured extraction. No auth, no JS-rendering fallback, no adaptive
 * discovery yet — those come in later phases.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * Fixed guess list of sub-paths that frequently contain values/mission
 * content. Phase 6 replaces "fixed" with "adaptive" — for now, this is the
 * whole crawl.
 */
const RECOMMENDED_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/our-story",
  "/company",
  "/culture",
  "/values",
  "/our-values",
  "/mission",
  "/who-we-are",
  "/careers",
  "/team",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
};

// ─── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return handleHealth();
      }

      if (url.pathname === "/extract" && request.method === "POST") {
        return handleExtract(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse({ error: "Internal server error", detail: err.message }, 500);
    }
  },
};

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleHealth() {
  return jsonResponse({
    service: "Company Values Extractor",
    status: "ok",
    phase: 2,
    endpoints: {
      "POST /extract": "Extract structured company values. Body: { url: string }",
    },
    model: MODEL,
  });
}

async function handleExtract(request, env) {
  // ── Parse input ───────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const rawUrl = (body.url || "").trim();
  if (!rawUrl) {
    return jsonResponse({ error: 'Body must include a "url" field.' }, 400);
  }

  let baseUrl;
  try {
    baseUrl = normalizeBase(rawUrl);
  } catch {
    return jsonResponse({ error: `Invalid URL: ${rawUrl}` }, 400);
  }

  const maxChars = parseInt(env.MAX_PAGE_CHARS ?? "8000", 10);
  const timeoutMs = parseInt(env.FETCH_TIMEOUT_MS ?? "8000", 10);

  // ── Crawl the fixed candidate pages ────────────────────────────────────────
  const crawlResults = await crawlPages(baseUrl, RECOMMENDED_PATHS, timeoutMs);
  const sourcePages = crawlResults.filter((r) => r.ok).map((r) => r.url);

  if (sourcePages.length === 0) {
    return jsonResponse({
      error: "Could not fetch any pages from the provided URL.",
      attempted: crawlResults.map((r) => r.url),
    }, 502);
  }

  // ── Build combined context for AI ─────────────────────────────────────────
  const context = buildContext(crawlResults, maxChars);

  // ── Ask AI to extract structured values ───────────────────────────────────
  const extraction = await extractWithAI(env.AI, context, baseUrl);

  // ── Return result ─────────────────────────────────────────────────────────
  return jsonResponse({
    ...extraction,
    sourcePages,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  });
}

// ─── Crawling ─────────────────────────────────────────────────────────────────

function normalizeBase(raw) {
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  const u = new URL(raw);
  return `${u.protocol}//${u.host}`;
}

async function crawlPages(baseUrl, paths, timeoutMs) {
  const results = await Promise.allSettled(
    paths.map((path) => fetchPagePlain(`${baseUrl}${path}`, timeoutMs))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { url: `${baseUrl}${paths[i]}`, ok: false, text: "", error: r.reason?.message };
  });
}

async function fetchPagePlain(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CompanyValuesBot/1.0; +https://workers.dev)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`Plain fetch failed for ${url}: HTTP ${res.status}`);
      return { url, ok: false, text: "", status: res.status };
    }

    const html = await res.text();
    const text = stripHtml(html);
    const ok = text.length > 100;
    if (!ok) console.warn(`Plain fetch for ${url} returned only ${text.length} chars of text`);
    return { url, ok, text, status: res.status };
  } catch (err) {
    console.warn(`Plain fetch threw for ${url}: ${err.name} — ${err.message}`);
    return { url, ok: false, text: "", error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Very lightweight HTML → plain-text: remove tags, decode common entities. */
function stripHtml(html) {
  return html
    .replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Combine successful page text and cap total length with a strict even
 * split across pages. This is the naive version — Phase 5 finds the bug
 * hiding in this exact function once the budget gets tight.
 */
function buildContext(crawlResults, maxTotalChars) {
  const successful = crawlResults.filter((r) => r.ok && r.text.length > 0);
  if (successful.length === 0) return "";

  const perPageBudget = Math.floor(maxTotalChars / successful.length);

  const chunks = successful.map((r) => {
    const snippet = r.text.slice(0, perPageBudget);
    return `--- PAGE: ${r.url} ---\n${snippet}`;
  });

  return chunks.join("\n\n");
}

// ─── AI calls ─────────────────────────────────────────────────────────────────

async function extractWithAI(AI, context, baseUrl) {
  const systemPrompt = `You are an expert at reading company websites and identifying a company's core values, mission, vision, and culture.
Given web page content from a company website, extract the following information in valid JSON only — no markdown fences, no extra commentary.

Return this exact JSON structure:
{
  "company": {
    "name": "string — the company's name",
    "website": "string — the base website URL",
    "industry": "string — inferred industry (or null if unclear)",
    "size": "string — inferred company size hint (Startup / SMB / Mid-Market / Enterprise / Unknown)"
  },
  "mission": "string — the company's mission statement (null if not found)",
  "vision": "string — the company's vision statement (null if not found)",
  "tagline": "string — the company's tagline or slogan (null if not found)",
  "values": [
    {
      "name": "string — short name of the value",
      "description": "string — what this value means for the company",
      "evidence": "string — a direct quote or paraphrase from the site supporting this value"
    }
  ],
  "culture": [
    "string — key cultural trait or principle (concise bullet)"
  ],
  "summary": "string — 2-3 sentence executive summary of who the company is and what they stand for"
}

Rules:
- Extract only what is genuinely present; do not invent values.
- The "values" array should contain 3-10 items.
- The "culture" array should contain 2-6 items.
- If a field cannot be determined, use null.
- Output only the JSON object, nothing else.`;

  const userPrompt = `Company website base URL: ${baseUrl}

Scraped web page content:
${context}

Extract the company values, mission, vision, culture, and summary.`;

  const response = await AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 2048,
    temperature: 0.2,
  });

  // NOTE: this line is the Phase 2 lab's bug. See the README's case study —
  // response.response is not always a string.
  const raw = (response?.response ?? "").trim();

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { rawResponse: raw, parseError: "AI response was not valid JSON" };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
