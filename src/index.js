/**
 * Company Values Extractor — Cloudflare Worker + Workers AI
 *
 * Endpoints
 * ---------
 *   GET  /              → health check / usage instructions
 *   POST /extract       → extract values from a company website
 *   POST /extract/full  → extract values + generate a formatted report
 *
 * Request body (JSON):
 *   { "url": "https://example.com", "apiKey": "optional-if-configured" }
 *
 * Response body (JSON):
 *   { "company": { ... }, "values": [...], "mission": "...", "vision": "...",
 *     "culture": [...], "sourcePages": [...], "model": "...", "generatedAt": "..." }
 */
 
// ─── Constants ────────────────────────────────────────────────────────────────
 
const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
 
/**
 * Recommended sub-paths that frequently contain values/mission content.
 * This is a starting guess, not the whole crawl — the homepage is always
 * fetched first and mined for its own real navigation links (see
 * discoverPaths()), since a site's actual structure often doesn't match
 * this list (e.g. no /values or /culture page at all, with everything
 * living under /careers instead).
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
    endpoints: {
      "POST /extract":
        "Extract structured company values. Body: { url: string, apiKey?: string }",
      "POST /extract/full":
        "Same as /extract but also returns a formatted markdown report.",
    },
    model: MODEL,
  });
}
 
async function handleExtract(request, env, includeReport) {
  // ── Auth (optional) ───────────────────────────────────────────────────────
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
 
  const maxChars = parseInt(env.MAX_PAGE_CHARS ?? "30000", 10);
  const timeoutMs = parseInt(env.FETCH_TIMEOUT_MS ?? "8000", 10);
  const renderTimeoutMs = parseInt(env.BROWSER_RENDER_TIMEOUT_MS ?? "25000", 10);

  // ── Fetch the homepage first so we can mine its own links ─────────────────
  // (Its content also anchors buildContext()'s "homepage" budget below, so
  // it must stay first in crawlResults regardless of what else is added.)
  const rootResult = await fetchPage(`${baseUrl}/`, timeoutMs, renderTimeoutMs, env);
  rootResult.discovery = "recommended";

  // ── Recommended paths, plus real paths discovered from the homepage ───────
  const discoveredPaths = discoverPaths(rootResult.links, RECOMMENDED_PATHS);
  if (discoveredPaths.length > 0) {
    console.warn(`Discovered ${discoveredPaths.length} path(s) from the homepage's own links: ${discoveredPaths.join(", ")}`);
  }
  const pathsToFetch = [...RECOMMENDED_PATHS.filter((p) => p !== "/"), ...discoveredPaths];

  // ── Crawl the rest of the candidate pages ─────────────────────────────────
  const restResults = await crawlPages(baseUrl, pathsToFetch, timeoutMs, renderTimeoutMs, env);
  const discoveredSet = new Set(discoveredPaths);
  restResults.forEach((r) => {
    let pathname;
    try {
      pathname = new URL(r.url).pathname;
    } catch {
      pathname = null;
    }
    r.discovery = pathname && discoveredSet.has(pathname) ? "root-link" : "recommended";
  });

  const crawlResults = [rootResult, ...restResults];

  // ── If a careers-style page came back, try to open one listed job ─────────
  let jobListingPage = null;
  const careersResult = crawlResults.find((r) => {
    if (!r.ok) return false;
    try {
      return /career/i.test(new URL(r.url).pathname);
    } catch {
      return false;
    }
  });
  if (careersResult) {
    const jobLink = findJobListingLink(careersResult);
    if (jobLink) {
      console.warn(`Careers page at ${careersResult.url} — following job listing ${jobLink}`);
      const jobResult = await fetchPage(jobLink, timeoutMs, renderTimeoutMs, env);
      jobResult.discovery = "job-listing";
      crawlResults.push(jobResult);
      jobListingPage = { url: jobLink, ok: jobResult.ok };
    } else {
      console.warn(`Careers page at ${careersResult.url} — no individual job listing link found on it`);
    }
  }

  const sourcePages = crawlResults.filter((r) => r.ok).map((r) => r.url);
  const pageStats = crawlResults
    .filter((r) => r.ok)
    .map((r) => ({
      url: r.url,
      source: r.source ?? "plain",
      discovery: r.discovery ?? "recommended",
      textLength: r.text.length,
    }));
  const skippedPages = crawlResults
    .filter((r) => !r.ok)
    .map((r) => ({ url: r.url, status: r.status ?? null, error: r.error ?? null }));

  if (skippedPages.length > 0) {
    console.warn("Skipped candidate pages:", JSON.stringify(skippedPages));
  }

  if (sourcePages.length === 0) {
    return jsonResponse({
      error: "Could not fetch any pages from the provided URL.",
      attempted: crawlResults.map((r) => r.url),
      discoveredPaths,
      skippedPages,
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
    pageStats,
    skippedPages,
    discoveredPaths,
    jobListingPage,
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
  // Strip path so we can append our own candidate paths
  return `${u.protocol}//${u.host}`;
}
 
async function crawlPages(baseUrl, paths, timeoutMs, renderTimeoutMs, env) {
  const results = await Promise.allSettled(
    paths.map((path) => fetchPage(`${baseUrl}${path}`, timeoutMs, renderTimeoutMs, env))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { url: `${baseUrl}${paths[i]}`, ok: false, text: "", links: [], error: r.reason?.message };
  });
}

/** Keywords hinting a same-origin link is worth crawling for values/culture content. */
const RELEVANT_LINK_KEYWORDS = [
  "about", "career", "culture", "value", "mission", "vision", "team",
  "story", "who", "why", "people", "life", "divers", "benefit", "difference",
];
const MAX_DISCOVERED_PATHS = 10;

function linkRelevanceScore(pathname) {
  const p = pathname.toLowerCase();
  return RELEVANT_LINK_KEYWORDS.some((k) => p.includes(k)) ? 1 : 0;
}

/**
 * Turn the homepage's own same-origin links into additional candidate
 * paths not already covered by RECOMMENDED_PATHS. Ranked so links whose
 * URL hints at values/culture/about-style content are kept first if there
 * are more than the cap — a site's real nav often includes plenty of
 * irrelevant links too (blog, contact, solutions) that aren't worth the
 * extra fetch/render cost.
 */
function discoverPaths(rootLinks, recommendedPaths) {
  const existing = new Set(recommendedPaths.map((p) => p.toLowerCase()));
  const seen = new Set();
  const candidates = [];

  for (const link of rootLinks || []) {
    let pathname;
    try {
      pathname = new URL(link).pathname;
    } catch {
      continue;
    }
    if (pathname.length > 1) pathname = pathname.replace(/\/$/, "");
    if (!pathname) pathname = "/";
    const key = pathname.toLowerCase();
    if (key === "/" || existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    candidates.push(pathname);
  }

  candidates.sort((a, b) => linkRelevanceScore(b) - linkRelevanceScore(a));
  return candidates.slice(0, MAX_DISCOVERED_PATHS);
}

/** Keywords hinting a link on a careers page points at an individual job posting. */
const JOB_LISTING_KEYWORDS = ["job", "position", "opening", "apply", "role"];

/**
 * Among a careers-style page's own discovered links, find one that looks
 * like an individual job posting: either nested under the careers page's
 * own path, or containing an obvious job-related keyword. Same-origin
 * only — third-party ATS embeds (Greenhouse, Lever, Workday, etc.) live on
 * a different origin and are out of scope here.
 */
function findJobListingLink(careersResult) {
  const careersPath = new URL(careersResult.url).pathname.replace(/\/$/, "");

  for (const link of careersResult.links || []) {
    let linkPath;
    try {
      linkPath = new URL(link).pathname.replace(/\/$/, "");
    } catch {
      continue;
    }
    if (linkPath === careersPath) continue;
    const nested = careersPath !== "" && linkPath.startsWith(careersPath + "/");
    const keywordMatch = JOB_LISTING_KEYWORDS.some((k) => linkPath.toLowerCase().includes(k));
    if (nested || keywordMatch) return link;
  }
  return null;
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
 * A definitive HTTP error status (e.g. 404) is trusted as-is — the path
 * doesn't exist, and rendering it anyway risks a SPA's client-side routing
 * fallback substituting unrelated homepage content in as if it came from
 * this path. Otherwise, if the result looks thin relative to the raw HTML
 * — a sign the page is client-side-rendered (Angular/React/Vue SPA) and
 * real content never made it into the server response — and
 * CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are configured, falls back
 * to Cloudflare's Browser Rendering /markdown quick action, which actually
 * runs the page's JavaScript.
 */
async function fetchPage(url, timeoutMs, renderTimeoutMs, env) {
  const plain = await fetchPagePlain(url, timeoutMs);

  // A definitive non-2xx status means the origin itself says this path
  // doesn't exist. Don't "rescue" it with a render: a full browser
  // navigation can hit a SPA's client-side routing fallback and render the
  // homepage for an unmapped route even though a plain fetch() correctly
  // got a real 404 — silently substituting unrelated homepage content in
  // as if it came from this path.
  if (plain.status != null && !plain.ok) return plain;

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
        "User-Agent":
          "Mozilla/5.0 (compatible; CompanyValuesBot/1.0; +https://workers.dev)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`Plain fetch failed for ${url}: HTTP ${res.status}`);
      await res.body?.cancel().catch(() => {});
      return { url, ok: false, text: "", htmlLength: 0, links: [], status: res.status };
    }

    const html = await res.text();
    const text = stripHtml(html);
    const links = extractLinksFromHtml(html, url);
    const ok = text.length > 100;
    if (!ok) console.warn(`Plain fetch for ${url} returned only ${text.length} chars of text`);
    return { url, ok, text, htmlLength: html.length, links, status: res.status, source: "plain" };
  } catch (err) {
    console.warn(`Plain fetch threw for ${url}: ${err.name} — ${err.message}`);
    return { url, ok: false, text: "", htmlLength: 0, links: [], error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render the page with Cloudflare's Browser Rendering REST API and convert
 * it to markdown. Unlike the /json quick action, /markdown does a
 * mechanical HTML-to-markdown conversion with no AI step — no risk of the
 * model failing to escape several KB of page text into a valid JSON string
 * (which is exactly what made /json return HTTP 422 on every real page).
 * https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/
 * Returns null (rather than throwing) on any failure so the caller can fall
 * back to a plain fetch.
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
      const body = await res.text().catch(() => "");
      console.warn(`Browser Rendering /markdown failed for ${url}: HTTP ${res.status} — ${body.slice(0, 500)}`);
      return null;
    }

    const data = await res.json();
    const text = data?.result;
    if (typeof text !== "string" || text.length <= 100) {
      console.warn(`Browser Rendering /markdown returned unusable text for ${url}: ${JSON.stringify(data).slice(0, 500)}`);
      return null;
    }

    const links = extractLinksFromMarkdown(text, url);

    return {
      url,
      ok: true,
      text: text.replace(/\s{2,}/g, " ").trim(),
      links,
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
 
/** File extensions that are never worth crawling as a "page". */
const NON_PAGE_EXTENSION_RE = /\.(png|jpe?g|gif|svg|webp|css|js|pdf|ico|xml|json|zip|mp4|mp3|woff2?|ttf)$/i;

/**
 * Pull same-origin, page-like links out of page content and return them as
 * deduplicated absolute URLs (query string and fragment stripped). Shared
 * by both fetch paths — only the regex for finding a raw link differs.
 */
function extractLinks(content, pageUrl, linkRe) {
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const found = new Set();
  let match;
  while ((match = linkRe.exec(content))) {
    const href = match[1];
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;

    let abs;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (NON_PAGE_EXTENSION_RE.test(abs.pathname)) continue;

    abs.hash = "";
    abs.search = "";
    let clean = abs.toString();
    if (clean.length > origin.length + 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
    found.add(clean);
  }
  return Array.from(found);
}

function extractLinksFromHtml(html, pageUrl) {
  return extractLinks(html, pageUrl, /href\s*=\s*["']([^"']*)["']/gi);
}

function extractLinksFromMarkdown(markdown, pageUrl) {
  return extractLinks(markdown, pageUrl, /\]\(([^)\s]+)\)/g);
}

/** Very lightweight HTML → plain-text: remove tags, decode common entities. */
function stripHtml(html) {
  return html
    // Remove scripts, styles, nav, footer blocks to reduce noise
    .replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Remove all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}
 
// ─── Context builder ──────────────────────────────────────────────────────────
 
/**
 * Combine successful page text, de-duplicate content, and cap total length.
 * The homepage gets a modest head start; other pages share the remainder,
 * with a floor per page (MIN_OTHER_PAGE_CHARS) regardless of how many
 * pages succeeded. Root-page link discovery and the careers/job-listing
 * follow-up mean the successful-page count is now variable and often
 * larger than the fixed recommended list alone — a strict even division
 * would shrink per-page budgets right back into the truncation bug fixed
 * earlier (a real page's content of interest cut off before the AI ever
 * saw it, since Browser-rendered pages carry nav/logo/frontmatter overhead
 * before any real body content starts). The tradeoff: total context sent
 * can exceed maxTotalChars when many pages succeed — acceptable given the
 * model's context window.
 */
const MIN_OTHER_PAGE_CHARS = 2500;

function buildContext(crawlResults, maxTotalChars) {
  const successful = crawlResults.filter((r) => r.ok && r.text.length > 0);
  if (successful.length === 0) return "";

  // Give the first result (homepage) a modest head start — 25 % of the
  // budget — rather than the outsized share it had before, since every
  // page needs enough room to get past its own nav/frontmatter overhead.
  const homeBudget = Math.floor(maxTotalChars * 0.25);
  const computedShare = Math.floor((maxTotalChars - homeBudget) / Math.max(1, successful.length - 1));
  const otherBudget = Math.max(MIN_OTHER_PAGE_CHARS, computedShare);

  const chunks = successful.map((r, i) => {
    const budget = i === 0 ? homeBudget : otherBudget;
    const snippet = r.text.slice(0, budget);
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
    // Strip any accidental markdown fences the model may have added
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // Return the raw text so the caller still gets something useful
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
 * so downstream .trim()/.replace() calls never throw.
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