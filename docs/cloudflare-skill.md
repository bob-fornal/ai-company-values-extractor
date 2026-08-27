# Cloudflare Workers — lessons learned

Notes accumulated while building [company-values-extractor](../src/index.js),
a Worker that crawls a site and uses Workers AI to extract it. Kept here so
the next Cloudflare Worker project doesn't have to relearn these the hard
way.

## `wrangler.toml`

### `workers_dev` / `preview_urls` warnings

`wrangler deploy` warns if `workers_dev` and `preview_urls` aren't set
explicitly — it silently defaults both to `true`. Set them explicitly to
silence the warning; there's no behavior change either way unless you
actually want them off:

```toml
workers_dev = true
preview_urls = true
```

### `[[rules]]` blocks need a real `type`

A `[[rules]]` block's `type` must be one of a fixed enum: `"ESModule"`,
`"CommonJS"`, `"Text"`, `"Data"`, `"CompiledWasm"`. Anything else fails
config validation and `wrangler deploy` will error out on the whole file —
which means **the live Worker keeps running whatever was last deployed
successfully**, silently, with no obvious signal that new code never
shipped. If behavior doesn't match the source you're looking at, check
that the last deploy actually succeeded before debugging the code itself.

This is also a reason to be suspicious of `wrangler.toml` edits made
through the Cloudflare dashboard's web editor rather than locally — they
can introduce exactly this kind of invalid config without the immediate
local feedback `wrangler deploy` would give you.

### Vars vs. secrets — vars are not private

Anything under `[vars]` is plaintext, full stop — visible in the
dashboard, and printed in cleartext by `wrangler deploy` whenever local
config differs from what's live (`wrangler` diffs and prints the value).
An API token pasted into `[vars]` (or added as a plaintext "Variable" in
the dashboard UI instead of a "Secret") should be treated as compromised
the moment that diff prints, because it's now sitting in terminal
scrollback and CI logs. Secrets must be set via:

```bash
wrangler secret put SOME_TOKEN
```

Secrets are encrypted at rest and `wrangler` never prints their value —
not in diffs, not in `wrangler secret list` (names only). Rule of thumb:
if a config value is a credential, it's a secret, never a var, even for
"just testing."

## Workers AI (`env.AI.run()`)

### `response.response` is not guaranteed to be a string

The typical Workers AI text-generation response is `{ response: "..." }`,
but depending on model/runtime version `response.response` can come back
as a non-string (an object) instead of `undefined`. Code like:

```js
const text = (response?.response ?? "").trim(); // throws if response.response is an object
```

throws `TypeError: ... .trim is not a function`, because `??` only
substitutes on `null`/`undefined` — a truthy non-string value sails right
through. Normalize defensively instead of trusting the shape:

```js
function aiResponseToText(response) {
  const value = response?.response;
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}
```

## Fetching other sites' pages from a Worker

### A plain `fetch()` never executes JavaScript

This is the big one. `fetch()` in a Worker gets exactly what the origin
server returns — nothing more. For a client-side-rendered SPA (Angular,
React, Vue, etc. without server-side rendering/prerendering), whatever
content JavaScript injects after the page loads — entire sections,
headings with no content under them — simply isn't in that HTML. No
amount of timeout or byte-budget tuning fixes this; the content isn't
there to find. Symptom to watch for: a heading like `Our Core Values`
followed immediately by unrelated content, with nothing filled in between.

**Diagnosing it:** fetch the page's raw HTML directly (`curl`, or `fetch()`
from a browser console on the *same* origin to dodge CORS) and search for
the specific text you expect. If it's missing from the raw HTML but
visible in the rendered page, it's client-side-rendered. A useful
secondary signal is `document.title`/`ng-version` or similar framework
markers, plus checking Network requests for whether the content comes
from a separate API call (in which case, hitting that API directly is
simpler and cheaper than rendering) or is baked into the JS bundle itself
with no API call at all (in which case only real rendering will surface
it).

### Link discovery has the same blind spot as content discovery

If you're scraping a page's `<a href>` links (e.g. to find more pages to
crawl), a plain `fetch()`'s raw HTML has the exact same problem as
before: on a client-side-rendered SPA, the navigation itself is often
rendered by JavaScript too, so the real links simply aren't in the raw
HTML any more than the real page content was. The fix is the same fix —
extract links from whatever Browser Rendering actually produced (in the
`/markdown` case, from `[label](url)` syntax) rather than from the raw
`fetch()` response. Practical implication: a link-discovery feature that
depends on Browser Rendering having run will quietly find nothing on a
plain `fetch()`-only page, without erroring — worth logging what it found
(or didn't) rather than failing silently.

### Redirects with an explicit port in `Location` are fine

A `301` `Location` header like `https://www.example.com:443/path`
(explicit `:443`) is unusual-looking but not a bug — both `curl -L` and a
Worker's `fetch(url, { redirect: "follow" })` handle it transparently.
Don't chase this as a cause if a fetch seems to fail; look elsewhere
first.

### Cost/reliability heuristic for "does this page need real rendering?"

A flat minimum-character-count check is not a reliable signal for "this
page is a JS shell." A real page can render out to a couple thousand
characters of narrative text via a plain fetch and *still* be missing the
specific list/section you care about, because it's short relative to the
page, not short in absolute terms. What worked: compare extracted text
length to *raw HTML* length. A client-rendered SPA shell has a large JS
bundle and CSS but a tiny fraction of that translating to real static
text — commonly under 5% — while a normal content-heavy static page is
typically well above that. Use both an absolute floor (for near-empty
pages) and a ratio (for the "reasonable length text, still missing the
part you need" case):

```js
function looksThin(textLength, htmlLength) {
  if (textLength < 300) return true;
  return htmlLength > 0 && textLength / htmlLength < 0.05;
}
```

Try the cheap plain `fetch()` first always; only pay for real rendering
when the result looks thin by this heuristic.

### Don't render a path the origin already 404'd

Corollary to the above: only fall back to rendering when the plain fetch
either errored at the network layer (timeout, DNS, etc. — `status` is
undefined) or got a real 2xx response that looked thin. If the plain
fetch got a definitive non-2xx status (a real 404, for instance), trust
it and skip rendering that path entirely.

The reason is subtle and easy to miss: many SPA deployments serve
`index.html` (200, the homepage) to a **full browser navigation** for any
unmapped route — that's exactly what a client-side router needs to take
over and show its own 404 page — while a non-navigation `fetch()` request
to the same URL can get a stricter, honest 404 straight from the origin
server. Browser Rendering navigates like a real browser. The result:
render a dozen made-up candidate paths that don't exist, and several of
them can silently come back "successful," each containing the *homepage's*
content, indistinguishable from a real success unless you specifically
check for it. Multiply that into a combined-context pipeline (crawl N
candidate paths, concatenate their text for one summarizing AI call) and
these duplicate homepage renders drown out the one page that actually had
the unique content you were after — the symptom looks like "the AI just
won't use the right page," when the actual cause is "several fake pages
are silently contributing duplicate homepage content that outweighs the
real one." Caught this via a per-page `source`/`textLength` diagnostic in
the API response (see below) — without that visibility, it's very hard to
tell "rendered successfully" apart from "rendered successfully, but it's
the wrong page's content."

## Browser Rendering REST API

Renders a real headless browser page — the actual fix for the client-side-
rendering problem above. Called over plain HTTPS with an API token, **not**
through a Wrangler binding — quick actions (`/content`, `/markdown`,
`/json`, `/screenshot`, `/pdf`, `/scrape`, `/links`, `/crawl`,
`/accessibilityTree`, `/snapshot`) are separate REST endpoints:

```
POST https://api.cloudflare.com/client/v4/accounts/<accountId>/browser-rendering/<action>
Authorization: Bearer <apiToken>   (token needs "Browser Rendering - Edit" permission)
Content-Type: application/json
```

(The binding-based approach, `env.BROWSER` + Puppeteer/Playwright via
`@cloudflare/puppeteer`, is a different, heavier feature for driving full
browser *sessions* — multi-step interaction, screenshots mid-flow, etc.
Quick actions are the right fit for "render this one page and give me
something back.")

### `/json` — fragile for whole-page text extraction

`/json` renders the page then asks an AI model (default
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, overridable via `custom_ai`)
to extract data matching a `prompt` and/or `response_format` JSON Schema.
It's built for pulling a handful of small structured fields out of a page
— not for round-tripping an entire page's worth of text through a single
JSON string field. Asking it to return `{ "text": "<everything on the
page>" }` reliably fails with `HTTP 422` and an error like:

```
"Unable to form JSON based on user prompt and/or webpage text.
 Please try with a different prompt try passing a response_format."
```

— even when a `response_format` *is* being passed. The model does
generate reasonable content internally (visible in the error's
`rawAiResponse` field), but fails to escape several KB of markdown-ish
text (quotes, brackets, colons) into valid strict JSON. This isn't a fluke
on one page; it failed on every real page tried. Treat `/json` as suited
to small, bounded extractions only.

### `/markdown` — the reliable choice for "give me the rendered text"

`/markdown` does a mechanical HTML→markdown conversion of the rendered
page — no AI step, so there's no JSON-escaping failure mode to hit. If
the goal is "get me this page's real (JS-rendered) text so *I* can decide
what to do with it," prefer this over `/json`:

```json
// POST .../browser-rendering/markdown
{ "url": "https://example.com/some-page" }
```

```json
// 200 response
{ "success": true, "result": "# Page Title\n\nRendered markdown content..." }
```

Reserve `/json` for cases where you actually want Cloudflare's AI to
extract a small, well-defined set of fields directly from a page in one
call — not as a general-purpose "get me the text" mechanism.

### Give rendering its own, longer timeout

Rendering a real page (network idle wait, JS execution) plus any AI step
routinely takes several seconds — much longer than a plain `fetch()`.
Sharing one timeout constant between "cheap plain fetch" and "spin up a
browser" means the render path gets starved. Use a separate, larger
timeout for it (25s worked as a starting point vs. 8s for plain fetch).

## Concurrency and unread response bodies

The Workers runtime enforces a limit on concurrent *in-flight, unread*
HTTP responses. If a response is returned from `fetch()` and its body is
never read (or explicitly canceled) before the Worker moves on and opens
more connections, the runtime will eventually kill the oldest stalled one
to avoid deadlock — logged as:

```
A stalled HTTP response was canceled to prevent deadlock. ...
make sure to either read the body of every HTTP Response or call
response.body.cancel() to cancel a response that you don't plan to read from.
```

This is easy to introduce by accident in an early-return branch — e.g.
returning immediately on a non-2xx status without touching the body:

```js
// leaks the response body — triggers the runtime warning under concurrency
if (!res.ok) return { ok: false, status: res.status };
```

```js
// fixed — explicitly cancel what you're not going to read
if (!res.ok) {
  await res.body?.cancel().catch(() => {});
  return { ok: false, status: res.status };
}
```

This matters more than it looks like on a single request — it compounds
badly with fan-out (`Promise.allSettled` over many `fetch()` calls at
once, e.g. crawling a dozen candidate pages in parallel), where several
unread bodies can pile up simultaneously and start causing spurious
`AbortError`s on otherwise-fine requests.

## Crawling adaptively instead of guessing

A fixed list of likely paths (`/about`, `/careers`, `/values`, ...) is a
reasonable starting point but will always miss some real sites — this
project's own test site is a direct example: most of the guessed paths
404'd, while the real navigation (different names entirely) was never
guessed, and the actual values content lived only under `/careers` with
no dedicated values/culture page at all. Two adaptations that generalize
well beyond this project:

- **Scrape the homepage's own links for more candidates.** Fetch the
  homepage first (rather than in the same batch as everything else), pull
  its same-origin links out, and treat any not already covered by the
  guess list as additional candidates — capped, and ranked by whether the
  URL itself hints at relevant content, so an unbounded nav/footer doesn't
  turn into an unbounded crawl.
- **Follow a link one level deeper when it's likely to matter.** A
  careers page is a page *about* jobs; the actual content of interest
  (values mentioned in a listing, for instance) can be one hop further
  in, on an individual posting. Worth a narrow, targeted second fetch
  rather than trying to guess that specific URL up front.

**Watch the budget math when page count becomes variable.** Once "how
many pages succeed" isn't a fixed number anymore, a context-building step
that strictly divides a fixed total budget across N pages will shrink
per-page shares as N grows — silently reintroducing a truncation bug that
was already fixed once at a smaller, fixed N. Give each page a minimum
floor instead of a strict share, and let the total sent grow with page
count (bounded by the model's actual context window, not an arbitrary
config value).

**Deduplicate by URL, not by assumption.** A homepage can legitimately
link to itself under more than one path (a logo link to `/home` alongside
the real `/` route, for instance). URL-based dedup won't catch that — it's
not the same URL — and catching it would require content-based
comparison. Judge whether that complexity is worth it against the actual
cost of an occasional redundant (not incorrect) fetch.

## Debugging workflow that actually worked here

1. **Reproduce outside the Worker first.** `curl -sL -D -` against the
   target URL (status, headers, redirect chain, body) is faster to
   iterate on than redeploying a Worker, and rules out "is this even the
   Worker's fault" before touching Worker code.
2. **Add real logging, then read `wrangler tail`.** Guessing at failure
   causes from code review alone repeatedly missed the actual cause here
   (invalid config silently blocking deploys, credentials simply unset,
   the specific `/json` 422 error body). `console.warn` at every
   fetch/render failure branch, surfaced live via `wrangler tail`, found
   each root cause in one shot once it was in place.
3. **Return diagnostics in the response, not just logs.** A `pageStats`-
   style field (per-page: which fetch path was used, how much text it
   got) turns "is this working?" into something the caller can check
   directly from the API response, without needing log access at all.
