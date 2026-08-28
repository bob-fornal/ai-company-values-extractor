# Phase 2 — Crawling & AI Extraction

**Duration:** 35 minutes
**Builds on:** [Phase 1](../phase-1-project-setup/README.md)
**Ends with:** a working `POST /extract` that crawls a fixed list of pages and asks Workers AI to extract structured values

## Learning objectives

By the end of this phase you can:

- Wire up the `AI` binding in `wrangler.toml` and call `env.AI.run()`
- Fetch multiple pages concurrently with `Promise.allSettled`, and handle
  partial failure gracefully (some pages 404, that's fine)
- Convert raw HTML to plain text well enough for an LLM prompt
- Combine several pages' text into one bounded context string
- Recognize and fix a real Workers AI response-shape bug

## Walkthrough

1. Add the `AI` binding: see `wrangler.toml` — Workers AI needs to be
   enabled on your Cloudflare account.
2. Read `crawlPages()` / `fetchPagePlain()` — note that a failed fetch
   (timeout, 404, network error) becomes `{ ok: false }`, not a thrown
   exception. `Promise.allSettled` (not `Promise.all`) is what makes "some
   pages fail" a normal outcome instead of an all-or-nothing failure.
3. Read `buildContext()` — a **strict even split** of `MAX_PAGE_CHARS`
   across every successful page. Simple, and it works fine at 12 fixed
   pages and an 8,000-character budget. Keep this function in mind — it's
   not done yet.
4. Run it:

   ```bash
   wrangler dev
   curl -X POST http://localhost:8787/extract \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}'
   ```

## Case study: `response.response is not a function`

Somewhere during testing you will likely see this in your terminal:

```
TypeError: ((intermediate value) ?? "").trim is not a function
```

Look at `extractWithAI()` — specifically this line:

```js
const raw = (response?.response ?? "").trim();
```

This looks safe: `??` substitutes `""` whenever `response.response` is
`null` or `undefined`. But Workers AI doesn't always return
`response.response` as a string — depending on model/runtime version, it
can come back as a non-string **object**. An object is neither `null` nor
`undefined`, so it sails straight past `??`, and `.trim()` doesn't exist on
a plain object.

This is a real production incident, not a hypothetical: same symptom, same
root cause, found in the dashboard's runtime console.

## Hands-on lab

Fix the bug above. Write a small normalizer that handles all three shapes
Workers AI might hand back — string, object, or `null`/`undefined` — and
call it instead of trusting `response.response` directly.

**Constraints:**
- Don't just wrap the existing line in a `try/catch` — that hides the bug
  instead of fixing the actual type mismatch.
- Your fix should work whether `response.response` is a string, an object,
  or missing entirely.

<details>
<summary>Solution</summary>

```js
function aiResponseToText(response) {
  const value = response?.response;
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}
```

Then in `extractWithAI()`:

```js
const raw = aiResponseToText(response).trim();
```

The key insight: check `typeof` explicitly instead of relying on `??` to
catch every "not a real value" case — `??` only ever catches
`null`/`undefined`, nothing else.

</details>

## Checkpoint

Before moving to [Phase 3](../phase-3-securing-endpoint/README.md), your
`POST /extract` should:

- Crawl all 12 paths in `RECOMMENDED_PATHS`
- Return structured JSON (`company`, `mission`, `values`, `culture`, ...)
- Use `aiResponseToText()` rather than trusting `response.response` directly
