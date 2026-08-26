# Company Values Extractor

A Cloudflare Worker that crawls a company's website and uses Workers AI
(`@cf/meta/llama-4-scout-17b-16e-instruct`) to extract its mission, vision,
core values, and culture as structured JSON — optionally with a formatted
markdown report.

## How it works

1. You POST a company URL to the Worker.
2. The Worker fetches a fixed list of likely pages (`/`, `/about`,
   `/careers`, `/values`, etc.) and reduces each to plain text — see
   [Handling JavaScript-rendered pages](#handling-javascript-rendered-spa-pages)
   below for how that fetch works.
3. The combined text is sent to Workers AI with a prompt that asks for a
   strict JSON extraction of company info, mission, vision, values, and
   culture.
4. `/extract/full` additionally asks the model to turn that JSON into a
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
  "sourcePages": ["https://example.com/", "https://example.com/about"],
  "pageStats": [
    { "url": "https://example.com/", "source": "plain", "textLength": 1840 },
    { "url": "https://example.com/about", "source": "browser-rendering", "textLength": 3021 }
  ],
  "skippedPages": [
    { "url": "https://example.com/careers", "status": 404, "error": null }
  ],
  "model": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "generatedAt": "2026-08-26T00:00:00.000Z",
  "report": "# Company Overview\n..."
}
```

`report` is only present when calling `/extract/full`. `pageStats` tells
you how each page in `sourcePages` was actually fetched — `"plain"` means
a plain `fetch()` was used as-is; `"browser-rendering"` means the plain
fetch looked thin and the Browser Rendering fallback (see below) was used
instead. If a page you expected to be JS-rendered still shows `"plain"`,
either Browser Rendering isn't configured (see the setup steps below) or
the fallback failed — check `wrangler tail` / the dashboard's real-time
Logs, where the reason is logged either way. `skippedPages` lists any
candidate page that couldn't be used at all, with its HTTP status and/or
error message.

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
| `MAX_PAGE_CHARS`             | `8000`  | Max characters of crawled text sent to the AI per request   |
| `FETCH_TIMEOUT_MS`           | `8000`  | Timeout in ms per plain-fetch candidate page request         |
| `BROWSER_RENDER_TIMEOUT_MS`  | `25000` | Timeout in ms per Browser Rendering fallback request         |
| `CLOUDFLARE_ACCOUNT_ID`      | Unset   | Enables Browser Rendering (see above) when paired with `CLOUDFLARE_API_TOKEN` |

Set as a secret (not in `wrangler.toml`):

| Secret                  | Required | Description                                      |
|--------------------------|----------|---------------------------------------------------|
| `API_KEY`                | No       | If set, required via `X-Api-Key` or `Authorization: Bearer` header |
| `CLOUDFLARE_API_TOKEN`   | No       | Enables Browser Rendering (see above); needs "Browser Rendering - Edit" permission |
