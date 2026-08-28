/**
 * Company Values Extractor — Cloudflare Worker + Workers AI
 * PHASE 3: Securing the endpoint
 *
 * Endpoints
 * ---------
 *   GET  /              → health check / usage instructions (never protected)
 *   POST /extract        → extract structured values from a company website
 *   POST /extract/full   → same as /extract, plus a generated markdown report
 *
 * New this phase: an optional API_KEY secret protects both POST endpoints,
 * and /extract/full adds a second AI call that turns the extraction into a
 * readable report. Still no JS-rendering fallback or adaptive discovery —
 * those come in later phases.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

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
      // Health check is always open — never gated behind API_KEY.
      if (url.pathname === "/" && request.method === "GET") {
        return handleHealth();
      }

      if (url.pathname === "/extract" && request.method === "POST") {
        return handleExtract(request, env, false);
      }

      if (url.pathname === "/extract/full" && request.method === "POST") {
        return handleExtract(request, env, true);
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
    phase: 3,
    endpoints: {
      "POST /extract": "Extract structured company values. Body: { url: string }",
      "POST /extract/full": "Same as /extract but also returns a formatted markdown report.",
    },
    model: MODEL,
  });
}

async function handleExtract(request, env, includeReport) {
  // ── Auth (optional — only enforced when API_KEY is configured) ────────────
  if (env.API_KEY) {
    const provided =
      request.headers.get("X-Api-Key") ||
      request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== env.API_KEY) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

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

  // ── Optionally generate a markdown report ─────────────────────────────────
  let report = null;
  if (includeReport && extraction) {
    report = await generateReport(env.AI, extraction, baseUrl);
  }

  // ── Return result ─────────────────────────────────────────────────────────
  const result = {
    ...extraction,
    sourcePages,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
  if (report !== null) result.report = report;

  return jsonResponse(result);
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

  const raw = aiResponseToText(response).trim();

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { rawResponse: raw, parseError: "AI response was not valid JSON" };
  }
}

async function generateReport(AI, extraction, baseUrl) {
  const systemPrompt = `You are a business analyst. Given structured data about a company's values and culture, produce a concise, professional markdown report.
The report should have these sections:
1. Company Overview
2. Mission & Vision
3. Core Values (table or list with descriptions)
4. Cultural Principles
5. Strategic Implications (brief paragraph on what these values signal about the company)

Use clean markdown. Be concise but thorough.`;

  const userPrompt = `Here is the extracted data for ${baseUrl}:

${JSON.stringify(extraction, null, 2)}

Write the markdown report now.`;

  const response = await AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1500,
    temperature: 0.4,
  });

  return aiResponseToText(response).trim();
}

/**
 * Workers AI can return `response` as a plain string, or (depending on the
 * model/runtime version) as an object. Normalize either case to a string
 * so downstream .trim()/.replace() calls never throw. (Fixed in Phase 2.)
 */
function aiResponseToText(response) {
  const value = response?.response;
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
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
