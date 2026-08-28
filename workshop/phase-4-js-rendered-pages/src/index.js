/**
 * Company Values Extractor — Cloudflare Worker + Workers AI
 * PHASE 4: Handling JavaScript-rendered (SPA) pages
 *
 * Endpoints
 * ---------
 *   GET  /              → health check / usage instructions (never protected)
 *   POST /extract        → extract structured values from a company website
 *   POST /extract/full   → same as /extract, plus a generated markdown report
 *
 * New this phase: a plain fetch() never runs a page's JavaScript, so a
 * client-side-rendered SPA (Angular/React/Vue with no SSR) can look
 * "successful" while actually containing none of its real content. This
 * phase adds a Browser Rendering fallback, gated by a thin-content
 * heuristic — see fetchPage() below, which has this phase's lab left in it.
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
    phase: 4,
    endpoints: {
      "POST /extract": "Extract structured company values. Body: { url: string }",
      "POST /extract/full": "Same as /extract but also returns a formatted markdown report.",
    },
    model: MODEL,
  });
}

async function handleExtract(request, env, includeReport) {
  if (env.API_KEY) {
    const provided =
      request.headers.get("X-Api-Key") ||
      request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== env.API_KEY) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

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
  const renderTimeoutMs = parseInt(env.BROWSER_RENDER_TIMEOUT_MS ?? "25000", 10);

  const crawlResults = await crawlPages(baseUrl, RECOMMENDED_PATHS, timeoutMs, renderTimeoutMs, env);
  const sourcePages = crawlResults.filter((r) => r.ok).map((r) => r.url);

  if (sourcePages.length === 0) {
    return jsonResponse({
      error: "Could not fetch any pages from the provided URL.",
      attempted: crawlResults.map((r) => r.url),
    }, 502);
  }

  const context = buildContext(crawlResults, maxChars);
  const extraction = await extractWithAI(env.AI, context, baseUrl);

  let report = null;
  if (includeReport && extraction) {
    report = await generateReport(env.AI, extraction, baseUrl);
  }

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

async function crawlPages(baseUrl, paths, timeoutMs, renderTimeoutMs, env) {
  const results = await Promise.allSettled(
    paths.map((path) => fetchPage(`${baseUrl}${path}`, timeoutMs, renderTimeoutMs, env))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { url: `${baseUrl}${paths[i]}`, ok: false, text: "", error: r.reason?.message };
  });
}

/**
 * A page's extracted text is a small fraction of its raw HTML — the
 * hallmark of a client-side-rendered shell where real content is injected
 * by JavaScript that a plain fetch() never runs. `minChars` is a floor for
 * near-empty pages where the ratio isn't meaningful.
 */
const THIN_CONTENT_MIN_CHARS = 300;
const THIN_CONTENT_MIN_RATIO = 0.05;

function looksThin(textLength, htmlLength) {
  if (textLength < THIN_CONTENT_MIN_CHARS) return true;
  return htmlLength > 0 && textLength / htmlLength < THIN_CONTENT_MIN_RATIO;
}

/**
 * Fetch a page's text content. Tries a plain fetch() first (cheap, fast).
 * If the result looks thin — a sign of client-side rendering — and
 * CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are configured, falls back
 * to Cloudflare's Browser Rendering /markdown quick action, which actually
 * runs the page's JavaScript.
 *
 * ── THIS PHASE'S LAB ─────────────────────────────────────────────────────
 * As written, this function has a real bug from the project's history: it
 * doesn't distinguish "the plain fetch failed to find much text" from "the
 * plain fetch got a definitive 404, the path doesn't exist." Read the
 * README's case study, then fix it here.
 */
async function fetchPage(url, timeoutMs, renderTimeoutMs, env) {
  const plain = await fetchPagePlain(url, timeoutMs);

  const canRender = env?.CLOUDFLARE_ACCOUNT_ID && env?.CLOUDFLARE_API_TOKEN;
  if (!canRender) {
    console.warn(`Browser Rendering not configured (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN unset) — using plain fetch only for ${url}`);
    return plain;
  }
  if (plain.ok && !looksThin(plain.text.length, plain.htmlLength)) return plain;

  console.warn(`${url} looks thin (${plain.text.length} chars / ${plain.htmlLength} html) — falling back to Browser Rendering`);
  const rendered = await fetchPageViaBrowserRendering(url, renderTimeoutMs, env);
  console.warn(`Browser Rendering for ${url} ${rendered ? "succeeded" : "failed, keeping plain fetch result"}`);
  return rendered ?? plain;
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
      // A response body that's never read (or canceled) trips the Workers
      // runtime's concurrent-in-flight-response limit once enough of these
      // pile up in a Promise.allSettled fan-out. See the README case study.
      await res.body?.cancel().catch(() => {});
      return { url, ok: false, text: "", htmlLength: 0, links: [], status: res.status };
    }

    const html = await res.text();
    const text = stripHtml(html);
    const ok = text.length > 100;
    if (!ok) console.warn(`Plain fetch for ${url} returned only ${text.length} chars of text`);
    return { url, ok, text, htmlLength: html.length, status: res.status, source: "plain" };
  } catch (err) {
    console.warn(`Plain fetch threw for ${url}: ${err.name} — ${err.message}`);
    return { url, ok: false, text: "", htmlLength: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render the page with Cloudflare's Browser Rendering REST API and convert
 * it to markdown. Uses the /markdown quick action — a mechanical
 * HTML-to-markdown conversion with no AI step. (See README case study for
 * why not /json.) Returns null (rather than throwing) on any failure so the
 * caller can fall back to the plain fetch result.
 * https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/
 */
async function fetchPageViaBrowserRendering(url, timeoutMs, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown`;
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`Browser Rendering /markdown failed for ${url}: HTTP ${res.status} — ${errBody.slice(0, 500)}`);
      return null;
    }

    const data = await res.json();
    const text = data?.result;
    if (typeof text !== "string" || text.length <= 100) {
      console.warn(`Browser Rendering /markdown returned unusable text for ${url}: ${JSON.stringify(data).slice(0, 500)}`);
      return null;
    }

    return {
      url,
      ok: true,
      text: text.replace(/\s{2,}/g, " ").trim(),
      status: res.status,
      source: "browser-rendering",
    };
  } catch (err) {
    console.warn(`Browser Rendering /markdown threw for ${url}: ${err.name} — ${err.message}`);
    return null;
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
