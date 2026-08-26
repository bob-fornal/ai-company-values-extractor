# Decision Log — Company Values Extractor

A chronological record of every problem, investigation, and fix that went
into getting accurate company-values extraction working for
[company-values-extractor](../src/index.js), from initial documentation
through the final working state. Written for a later walkthrough/
presentation of the debugging process, not as ongoing technical reference
— for the reusable technical lessons on their own, see
[cloudflare-skill.md](cloudflare-skill.md).

## Summary

| # | Problem | Root Cause | Fix |
|---|---------|------------|-----|
| 1 | No project documentation | N/A | Wrote `README.md` covering endpoints, deployment, and secret management |
| 2 | `wrangler deploy` config warnings | `workers_dev`/`preview_urls` left implicit | Set both explicitly in `wrangler.toml` |
| 3 | `TypeError: ... .trim is not a function` | Workers AI can return `response.response` as a non-string | Added `aiResponseToText()` normalizer |
| 4 | `/careers` Core Values missing from output | Site is a client-rendered Angular SPA with no SSR; plain `fetch()` never runs JavaScript | Added Cloudflare Browser Rendering as a fallback fetch path |
| 5 | API token exposed in plaintext in `wrangler deploy` output | Token was set as a dashboard **variable**, not a **secret** | Revoked token, instructed proper `wrangler secret put` |
| 6 | Always rendering every page is slow/costly | No signal distinguishing "needs JS" pages from normal ones | Added `looksThin()` ratio heuristic — plain fetch first, render only when thin |
| 7 | `/careers` disappeared from `sourcePages` entirely | Invalid `[[rules]]` block in `wrangler.toml` was silently failing `wrangler deploy`, so the live Worker was running stale code | Removed the invalid block; added `skippedPages` + logging diagnostics |
| 8 | `/careers` present but values still wrong (from homepage) | `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` were never actually configured on the deployed Worker — Browser Rendering silently never engaged | Added `pageStats`/`source` diagnostics; user set the account ID |
| 9 | Browser Rendering configured, but every render call failed `HTTP 422` | `/json` quick action's AI step couldn't reliably escape a full page of text into valid JSON | Switched to the `/markdown` quick action (no AI step, mechanical conversion) |
| 10 | Runtime warning: stalled HTTP response canceled | A 404 response body was never read or canceled | Added `res.body?.cancel()` on the unread-body branch |
| 11 | Rendering succeeded everywhere, but values were still from the homepage | Browser Rendering navigates like a real browser; the SPA's client routing served the homepage to *every* nonexistent candidate path, flooding the AI context with duplicate homepage content | Skip the render fallback entirely when the plain fetch got a confirmed non-2xx status |
| 12 | `CLOUDFLARE_ACCOUNT_ID` regressed back to unset between sessions | Config drift — `wrangler.toml` was being hand-edited outside the normal flow (confirmed via `git diff`, file was uncommitted/locally modified) | Re-set the value; flagged the workflow risk to the user |
| 13 | Clean crawl, but values were **still** from the homepage | `buildContext()`'s per-page character budget (1,600 chars for `/careers`) was too small — Browser-Rendered markdown's nav/logo/frontmatter overhead pushed the real "Our Core Values" section past the cutoff | Raised `MAX_PAGE_CHARS` 8,000 → 30,000; rebalanced homepage's share 40% → 25% |

Issue 13's fix resolved it — confirmed working.

## Detailed timeline

### 1. Initial documentation

**Ask:** Document the project and deployment, including protecting the API
endpoint with a secret key.

**Delivered:** `README.md` covering both endpoints, request/response
shapes, local dev, `wrangler deploy`, and `wrangler secret put API_KEY`
for locking down `/extract` and `/extract/full`.

### 2. `wrangler deploy` configuration warnings

**Symptom:** Two warnings on every deploy about `workers_dev` and
`preview_urls` not being set explicitly in `wrangler.toml`.

**Fix:** Set both to `true` explicitly — matches Wrangler's existing
default behavior, just silences the warning. No behavior change.

### 3. `TypeError: ((intermediate value) ?? "").trim is not a function`

**Symptom:** Runtime error surfaced in the Cloudflare dashboard console
for `index.js`.

**Root cause:** `(response?.response ?? "").trim()` only substitutes `""`
when `response.response` is `null`/`undefined` — but Workers AI can
return it as a non-string object depending on model/runtime version,
which sails straight past `??` and then has no `.trim()`.

**Fix:** Added `aiResponseToText()`, which normalizes any shape (string,
object, `null`) to a string before `.trim()`/`.replace()` ever run.

### 4. Core Values missing from `/careers` — the SPA rendering problem

**Symptom:** The extraction output never included leadingedje.com's
actual Core Values (`All In, Together`, `Keep It Real`, etc.), even
though `/careers` was being scanned.

**Investigation:** Fetched the page's raw HTML directly (via `curl` and a
browser `fetch()`) and confirmed the Core Values heading was present, but
the value names themselves were completely absent from the server
response — because leadingedje.com is an Angular SPA with no
server-side rendering. The values are injected into the DOM by
client-side JavaScript after the page loads, and a Worker's plain
`fetch()` never executes JavaScript.

**Decision point:** Asked how to handle JS-rendered pages generally
(browser-rendering fallback vs. always-render vs. document-only). The
user specified using Cloudflare's Browser Rendering **`/json`** Quick
Actions endpoint specifically.

**Fix (v1):** Implemented `fetchPageViaBrowserRendering()` calling the
`/json` REST endpoint, which renders the page with a real browser and
uses AI to extract the visible text into a JSON field. (This
implementation didn't survive — see #9.)

### 5. Leaked API token

**Symptom:** `wrangler deploy` printed the literal value of
`CLOUDFLARE_API_TOKEN` in a config-diff warning.

**Root cause:** The token had been added as a plaintext Variable in the
Cloudflare Dashboard instead of a Secret — Wrangler only ever prints
plaintext var values in diffs; real Secrets are always masked.

**Fix:** Instructed the user to revoke the exposed token immediately,
delete the plaintext dashboard variable, and set a new token properly via
`wrangler secret put CLOUDFLARE_API_TOKEN`.

### 6. Cost/latency concern — cheap heuristic fallback

**Ask:** Don't render every page — only fall back when the plain fetch
result actually looks like it's missing content.

**Decision:** A flat character-count minimum wasn't reliable — a real
page can produce a couple thousand characters of narrative text via plain
fetch and still be missing the specific section needed (this was
literally the `/careers` case: 2,090 characters of text, but none of it
was the Core Values). The working signal was **extracted-text-to-raw-HTML
ratio**: a client-rendered SPA shell has a large JS bundle translating to
very little static text (commonly under 5%), unlike a normal
content-heavy static page.

**Fix:** Added `looksThin()` — thin if under 300 characters absolute, or
under a 5% text-to-HTML ratio. Plain fetch always runs first (cheap);
Browser Rendering only engages when the result looks thin.

### 7. `/careers` disappeared from `sourcePages` entirely

**Symptom:** After adding the heuristic fallback, `/careers` no longer
appeared as a source page at all — a regression from before, when it at
least appeared (just without the real values).

**Investigation:** Code review didn't surface an obvious bug — the
fallback logic should always degrade gracefully back to the plain-fetch
result. Added real diagnostics instead of continuing to guess: a
`skippedPages` field in the API response (URL, status, error for every
dropped page) and `console.warn` logging at every failure branch, visible
via `wrangler tail`.

**Root cause (found via `git diff`, not logs):** `wrangler.toml` had
picked up an invalid `[[rules]]` block (`type` set to a value outside
Wrangler's fixed enum), most likely from an edit made directly in the
Cloudflare dashboard's file editor. This was failing `wrangler.toml`
validation, which meant **recent `wrangler deploy` runs had been failing
silently** — the live Worker was running stale code the whole time,
unrelated to whatever the current source actually said.

**Fix:** Removed the invalid block.

### 8. `/careers` present, but values still from the homepage

**Symptom:** `/careers` now appeared in `sourcePages`, but the extracted
`values` were clearly from the homepage's "The EDJE Difference" section
(`Positive Disruption`, `Expansive Thinking`, etc.), not `/careers`'s
actual Core Values.

**Investigation:** Being present in `sourcePages` doesn't distinguish "got
real rendered content" from "silently fell back to thin plain-fetch
content" — both look identical from the outside. Added a `source` tag
(`"plain"` vs `"browser-rendering"`) and `pageStats` (per-page source +
text length) to the API response, plus explicit logging of the
render-fallback decision itself.

**Root cause:** `wrangler tail` showed `"Browser Rendering not configured
(CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN unset)"` for every single
page — the account ID had never actually been set (it was still
commented out in `wrangler.toml` with a placeholder), so the entire
render fallback path had never once executed despite being implemented.

**Fix:** User set the real `CLOUDFLARE_ACCOUNT_ID`.

### 9. Browser Rendering configured, but every call failed `HTTP 422`

**Symptom:** With credentials finally in place, every `/json` call
returned `422: "Unable to form JSON based on user prompt and/or webpage
text."`

**Root cause:** `/json`'s internal AI model has to escape an entire
page's worth of text (several KB, full of quotes/brackets/markdown) into
one valid JSON string field — and reliably failed to do so, even with a
`response_format` schema supplied. The model was visibly generating
reasonable content (seen in the error's `rawAiResponse` field); it just
couldn't produce valid strict JSON containing all of it.

**Fix:** Switched to the **`/markdown`** quick action — same JS
rendering, but a mechanical HTML-to-markdown conversion with no AI step,
so there's no JSON-escaping failure mode to hit.

### 10. Runtime warning — stalled HTTP response canceled

**Symptom:** `wrangler tail` also showed: *"A stalled HTTP response was
canceled to prevent deadlock ... make sure to either read the body of
every HTTP Response or call response.body.cancel()."*

**Root cause:** `fetchPagePlain()`'s non-2xx branch (hit by every 404)
returned immediately without reading or canceling the response body —
with a dozen candidate paths fetched concurrently, this tripped the
Workers runtime's concurrent-connection ceiling.

**Fix:** Added `await res.body?.cancel()` before returning in that
branch.

### 11. Rendering succeeded everywhere — but values were *still* wrong

**Symptom:** `wrangler tail` showed Browser Rendering succeeding for
`/careers` and also for every single nonexistent candidate path
(`/mission`, `/about-us`, `/company`, etc. — nine 404s). Values were
still from the homepage.

**Root cause:** A plain `fetch()` correctly got real `404`s for those
nonexistent paths. But Browser Rendering navigates like an actual
browser — and Angular's client-side routing fallback serves the homepage
(`200`) to a full browser navigation for any unmapped route, even though
a non-navigation `fetch()` to the same URL gets a stricter, honest `404`.
The result: nine "successful" renders that were all silently duplicate
copies of the homepage, diluting `/careers`'s one real, unique
contribution in the combined AI context.

**Fix:** `fetchPage()` now trusts a confirmed non-2xx status from the
plain fetch and skips the render fallback entirely for that path, rather
than trying to "rescue" it.

### 12. Config drift — `CLOUDFLARE_ACCOUNT_ID` reverted

**Symptom:** After the fix in #11, logs showed `"Browser Rendering not
configured"` again — a full regression back to the state in #8.

**Investigation:** `git diff` showed `wrangler.toml` as locally modified
(uncommitted) with the account ID re-commented out — the real value was
still there, just prefixed with `#` again.

**Fix:** Uncommented it again. Flagged to the user that this file appears
to be getting hand-edited outside the normal flow (possibly the
Cloudflare dashboard's own editor), which is a process risk worth fixing
independently of the code — recommended either committing the working
config to git for a clear change history, or moving the account ID to a
secret (`wrangler secret put CLOUDFLARE_ACCOUNT_ID`) so no local file
edit can silently unset it.

### 13. Clean crawl, correct rendering — values still wrong

**Symptom:** With the SPA-fallback contamination fixed and credentials
stable, the crawl was finally clean (4 real pages: `/`, `/about`,
`/careers`, plus one edge-case duplicate via a timeout). Yet the
extracted values were *still* the homepage's, not `/careers`'s.

**Root cause:** `buildContext()`'s per-page character budget. With 4
successful pages and the original 8,000-character total (homepage getting
a 40% head start), `/careers` was capped at **1,600 characters**.
Independently measured, the "Our Core Values" heading sits roughly 1,811
characters into the page's plain-text rendering — and the
Browser-Rendered *markdown* version is heavier still (nav links render as
full `[Label](url)` syntax, plus title/description frontmatter, plus a
logo image). The 1,600-character slice was very likely being cut off
before the AI ever saw the real values — not because the model chose the
wrong content, but because the right content was never in its input.

**Fix:** Raised `MAX_PAGE_CHARS` from 8,000 to 30,000, and rebalanced the
homepage's share from 40% down to 25% so it doesn't crowd out other pages
as much.

**Outcome:** Confirmed working — the API now correctly returns
leadingedje.com's real Core Values from `/careers`.

## What changed in the codebase, end to end

- `src/index.js`:
  - `aiResponseToText()` — normalizes Workers AI response shape
  - `fetchPagePlain()` / `fetchPageViaBrowserRendering()` /
    `fetchPage()` — two-tier fetch strategy (cheap plain fetch, with a
    Browser Rendering `/markdown` fallback gated by a thin-content
    heuristic and a confirmed-404 skip)
  - `looksThin()` — ratio-based heuristic for "does this page need real
    rendering?"
  - `skippedPages` / `pageStats` in the API response — diagnostics for
    which pages were used, how, and why others weren't
  - `buildContext()` — rebalanced per-page character budget
  - `console.warn` logging at every fetch/render decision and failure
    point
- `wrangler.toml`:
  - `workers_dev` / `preview_urls` set explicitly
  - `CLOUDFLARE_ACCOUNT_ID` (var) / `CLOUDFLARE_API_TOKEN` (secret) for
    Browser Rendering
  - `BROWSER_RENDER_TIMEOUT_MS` — separate, longer timeout for rendering
    vs. plain fetch
  - `MAX_PAGE_CHARS` raised to 30,000
  - Removed an invalid `[[rules]]` block that had been silently breaking
    deploys
- `README.md`: documents all of the above — endpoints, deployment, secret
  management, the SPA-rendering fallback and its config, and the
  diagnostic response fields
- `docs/cloudflare-skill.md`: reusable technical lessons extracted from
  this process, for future Cloudflare Worker projects

## Takeaways for the presentation

1. **A symptom can have several stacked causes.** "Values are wrong" was,
   in sequence: a rendering problem, a leaked-credential problem, a stale
   deploy, an unset config value, a wrong API endpoint choice, an unread
   response body, an SPA-routing edge case, a config-drift problem, and
   finally a budget/truncation problem. Each fix was necessary but not
   sufficient on its own — the bug only fully resolved once all of them
   were addressed.
2. **Diagnostics beat guessing.** Code review alone repeatedly failed to
   find the actual cause (the invalid config block, the unset
   credentials, the specific 422 error body). Adding real logging and
   response diagnostics (`skippedPages`, `pageStats`, `source`) found each
   root cause in one round-trip once they were in place.
3. **Reproduce outside the system under test when possible.** Direct
   `curl` checks against the target site (status codes, redirect chains,
   raw HTML) repeatedly ruled out "is this the Worker's fault" faster
   than redeploying and re-testing the Worker itself would have.
4. **Config drift is a real failure mode.** Two separate regressions
   traced back to `wrangler.toml` being edited outside the normal
   deploy flow (the invalid rules block, and the account ID reverting).
   Worth solving as a process problem, not just re-fixing the symptom
   each time.
