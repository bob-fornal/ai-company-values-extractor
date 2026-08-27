# Company Values Extractor

A Cloudflare Worker that crawls a company's website and uses Workers AI
(`@cf/meta/llama-4-scout-17b-16e-instruct`) to extract its mission, vision,
core values, and culture as structured JSON — optionally with a formatted
markdown report.

## How it works

1. You POST a company URL to the Worker.
2. The Worker fetches the homepage, a recommended list of likely pages
   (`/about`, `/careers`, `/values`, etc.), and any additional pages
   discovered from the homepage's own links — see
   [Finding the right pages to crawl](#finding-the-right-pages-to-crawl)
   below — reducing each to plain text ([Handling JavaScript-rendered
   pages](#handling-javascript-rendered-spa-pages) covers how that fetch
   itself works).
3. If a careers-style page turns up, the Worker looks for a link to an
   individual job listing on it and, if found, fetches that page too —
   some companies list their values inside job postings rather than on
   the careers page itself.
4. The combined text from every page fetched is sent to Workers AI with a
   prompt that asks for a strict JSON extraction of company info, mission,
   vision, values, and culture.
5. `/extract/full` additionally asks the model to turn that JSON into a
   readable markdown report.

## Endpoints

| Method | Path            | Description                                              |
|--------|-----------------|------------------------------------------------------------|
| GET    | `/`             | Health check and usage info                                |
| POST   | `/extract`      | Extract structured values from a company website           |
| POST   | `/extract/full` | Same as `/extract`, plus a generated markdown report        |

### Request body

```json
{
  "url": "https://example.com"
}
```

`url` is required. It can be a bare domain (`example.com`) or a full URL
— the Worker normalizes it and strips any path before crawling.

### Response body

```json
{
  "company": {
    "name": "Example Inc.",
    "website": "https://example.com",
    "industry": "Software",
    "size": "SMB"
  },
  "mission": "...",
  "vision": "...",
  "tagline": "...",
  "values": [
    { "name": "Customer First", "description": "...", "evidence": "..." }
  ],
  "culture": ["..."],
  "summary": "...",
  "sourcePages": [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/careers",
    "https://example.com/careers/software-engineer"
  ],
  "pageStats": [
    { "url": "https://example.com/", "source": "browser-rendering", "discovery": "recommended", "textLength": 4422 },
    { "url": "https://example.com/about", "source": "plain", "discovery": "recommended", "textLength": 1840 },
    { "url": "https://example.com/careers", "source": "browser-rendering", "discovery": "recommended", "textLength": 2610 },
    { "url": "https://example.com/careers/software-engineer", "source": "browser-rendering", "discovery": "job-listing", "textLength": 3021 }
  ],
  "skippedPages": [
    { "url": "https://example.com/values", "status": 404, "error": null }
  ],
  "discoveredPaths": ["/solutions", "/blog", "/contact"],
  "jobListingPage": { "url": "https://example.com/careers/software-engineer", "ok": true },
  "model": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "generatedAt": "2026-08-26T00:00:00.000Z",
  "report": "# Company Overview\n..."
}
```

`report` is only present when calling `/extract/full`. `pageStats` tells
you how each page in `sourcePages` was actually fetched:

- `source` — `"plain"` means a plain `fetch()` was used as-is;
  `"browser-rendering"` means the plain fetch looked thin and the Browser
  Rendering fallback (see below) was used instead. If a page you expected
  to be JS-rendered still shows `"plain"`, either Browser Rendering isn't
  configured (see the setup steps below) or the fallback failed — check
  `wrangler tail` / the dashboard's real-time Logs, where the reason is
  logged either way.
- `discovery` — `"recommended"` means the path came from the built-in
  recommended list; `"root-link"` means it was found by scraping the
  homepage's own links (see
  [Finding the right pages to crawl](#finding-the-right-pages-to-crawl));
  `"job-listing"` means it's the individual job posting followed from a
  careers page.

`skippedPages` lists any candidate page that couldn't be used at all,
with its HTTP status and/or error message. `discoveredPaths` lists every
extra path found from the homepage's links (whether or not it ended up
fetchable — check `pageStats`/`skippedPages` for that). `jobListingPage`
is `null` when no careers page was found, or when one was found but no
individual job listing link could be located on it (e.g. a careers page
that's just a "contact us to apply" CTA with no job board).

## Finding the right pages to crawl

A fixed guess list of paths (`RECOMMENDED_PATHS` in
[src/index.js](src/index.js)) is a starting point, not the whole crawl —
plenty of real sites don't have a `/values` or `/culture` page at all, or
use different names entirely, while some of the guessed paths simply
don't exist on a given site. The Worker adapts in two ways:

1. **Homepage link discovery.** The homepage is always fetched first and
   scraped for its own same-origin links (`discoverPaths()` in
   [src/index.js](src/index.js)). Anything not already covered by the
   recommended list becomes an additional candidate page — up to 10,
   prioritized by whether the URL itself hints at relevant content (looks
   for words like `about`, `career`, `culture`, `value`, `mission`,
   `team`, `story`, `people`, etc.). This is how the Worker finds a site's
   *actual* navigation instead of only guessing at it.
2. **Careers → job listing follow-up.** If any crawled page's URL
   contains `career`, the Worker looks at that page's own discovered
   links for one that looks like an individual job posting (nested under
   the careers page's path, or containing a word like `job`, `position`,
   `opening`, `apply`, `role`) and fetches it too. Some companies state
   their values inside individual job postings rather than on the
   careers page itself. This only follows same-origin links — a careers
   page that embeds a third-party job board (Greenhouse, Lever, Workday,
   etc.) on a different domain isn't followed.

Link discovery depends on already having the page's real, JS-rendered
content to scrape links out of — on a client-side-rendered SPA, a plain
`fetch()`'s raw HTML often doesn't contain the real navigation links any
more than it contains the real page content (see below), so this feature
gets meaningfully better once Browser Rendering is configured. Without
it, the Worker still works — it just falls back to the recommended list
alone, same as before this feature existed.

> **Known limitation:** discovered links are deduplicated by URL, not by
> content — a homepage that links to itself under more than one path
> (e.g. both `/` and `/home`) can result in one near-duplicate fetch.
> Harmless (redundant content, not misleading content) but worth knowing
> about if `pageStats` shows more pages than you expected.

## Handling JavaScript-rendered (SPA) pages

By default the Worker fetches each candidate page with a plain `fetch()`,
which only ever sees the HTML the server returns. For sites built as a
client-side-rendered single-page app (Angular, React, Vue, etc. without
server-side rendering or prerendering), content that JavaScript injects
after the page loads — headings, lists, entire sections — simply isn't in
that HTML and gets missed. A `Our Core Values` heading with no values under
it, on an otherwise normal-looking page, is the typical symptom.

To fix this, the Worker can fall back to rendering a candidate page with
Cloudflare's
[Browser Rendering `/markdown` quick action](https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/),
which spins up a real headless browser, waits for JavaScript to run, and
converts the fully rendered page to markdown. (An earlier version of this
used the `/json` quick action, which uses an AI model internally — that
model reliably failed to escape a full page's worth of text into a valid
JSON string, returning `HTTP 422` on every real page. `/markdown` does a
mechanical HTML-to-markdown conversion with no AI step, so that failure
mode doesn't exist.) This is opt-in:

1. **Create an API token** at
   [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   with the **Browser Rendering - Edit** permission.
2. **Set your account ID** as a var in [wrangler.toml](wrangler.toml)
   (find it on your Cloudflare dashboard's Workers & Pages overview):

   ```toml
   [vars]
   CLOUDFLARE_ACCOUNT_ID = "your-account-id"
   ```

3. **Set the token as a secret** (never put this in `wrangler.toml`):

   ```bash
   wrangler secret put CLOUDFLARE_API_TOKEN
   ```

4. **Deploy**:

   ```bash
   wrangler deploy
   ```

Once both are set, every candidate page is still fetched with a plain
`fetch()` first — that's cheap and fast, and most sites don't need more.
Browser Rendering only kicks in when that result *looks thin*: fewer than
300 characters of extracted text, or an extracted-text-to-raw-HTML ratio
under 5% (the signature of a large JS bundle that rendered almost nothing
server-side — see `looksThin()` in
[src/index.js](src/index.js)). If the render call itself fails for any
reason (bad credentials, timeout, rate limit), that page silently falls
back to the plain `fetch()` result rather than failing the whole request.

> **Cost/latency note:** Browser Rendering spins up a real browser and
> uses Workers AI internally, so it's slower (several seconds) and billed
> separately from a plain `fetch()` — but with the heuristic above, it
> only runs for the handful of pages that actually need it. It gets its
> own, longer timeout (`BROWSER_RENDER_TIMEOUT_MS`, default 25s) separate
> from `FETCH_TIMEOUT_MS`, since rendering + AI extraction routinely takes
> longer than a plain fetch.

## Local development

Requires [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
and a Cloudflare account with Workers AI enabled.

```bash
npm install -g wrangler
wrangler dev
```

Then test it:

```bash
curl -X POST http://localhost:8787/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Deployment

```bash
wrangler deploy
```

This publishes the Worker using the settings in [wrangler.toml](wrangler.toml),
including the `AI` binding and the `MAX_PAGE_CHARS` / `FETCH_TIMEOUT_MS`
variables.

### Protecting the endpoint with an API key

By default, `/extract` and `/extract/full` are open to anyone who can
reach the Worker's URL. To lock them down, set an `API_KEY` secret — the
Worker checks for it automatically (see `handleExtract` in
[src/index.js](src/index.js)) and returns `401 Unauthorized` if it's
missing or doesn't match.

**1. Set the secret** (you'll be prompted to enter the value; it is
encrypted at rest and never stored in `wrangler.toml` or source control):

```bash
wrangler secret put API_KEY
```

**2. Deploy** (or redeploy) so the Worker picks it up:

```bash
wrangler deploy
```

**3. Call the endpoint with the key**, using either header:

```bash
curl -X POST https://<your-worker>.workers.dev/extract \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <your-secret-value>" \
  -d '{"url": "https://example.com"}'
```

```bash
curl -X POST https://<your-worker>.workers.dev/extract \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-secret-value>" \
  -d '{"url": "https://example.com"}'
```

Other useful secret management commands:

```bash
# List configured secret names (values are never shown)
wrangler secret list

# Rotate the key
wrangler secret put API_KEY

# Remove protection entirely
wrangler secret delete API_KEY
```

> **Note:** `GET /` (the health check) is never protected — only
> `/extract` and `/extract/full` require the key, and only when
> `API_KEY` is set.

## Configuration reference

Set in [wrangler.toml](wrangler.toml) under `[vars]`:

| Variable                     | Default | Description                                            |
|------------------------------|---------|------------------------------------------------------------|
| `MAX_PAGE_CHARS`             | `30000` | Target total characters of crawled text sent to the AI per request (soft cap — see note below) |
| `FETCH_TIMEOUT_MS`           | `8000`  | Timeout in ms per plain-fetch candidate page request         |
| `BROWSER_RENDER_TIMEOUT_MS`  | `25000` | Timeout in ms per Browser Rendering fallback request         |
| `CLOUDFLARE_ACCOUNT_ID`      | Unset   | Enables Browser Rendering (see above) when paired with `CLOUDFLARE_API_TOKEN` |

Set as a secret (not in `wrangler.toml`):

| Secret                  | Required | Description                                      |
|--------------------------|----------|---------------------------------------------------|
| `API_KEY`                | No       | If set, required via `X-Api-Key` or `Authorization: Bearer` header |
| `CLOUDFLARE_API_TOKEN`   | No       | Enables Browser Rendering (see above); needs "Browser Rendering - Edit" permission |

`MAX_PAGE_CHARS` is a target, not a hard ceiling: every non-homepage page
gets at least `MIN_OTHER_PAGE_CHARS` (2,500, a source constant, not
configurable) regardless of how many pages succeeded, so the total sent
to the AI can exceed `MAX_PAGE_CHARS` once homepage link discovery and
the job-listing follow-up are pulling in a variable, often larger number
of pages. A few other crawl-shaping values are source constants rather
than env vars — `MAX_DISCOVERED_PATHS` (10) and the relevance/job-listing
keyword lists in [src/index.js](src/index.js) — since they shape *what*
gets crawled rather than *how long* a request is allowed to take.
