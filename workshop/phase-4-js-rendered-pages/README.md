# Phase 4 — Handling JavaScript-Rendered (SPA) Pages

**Duration:** 40 minutes
**Builds on:** [Phase 3](../phase-3-securing-endpoint/README.md)
**Ends with:** a two-tier fetch strategy — cheap plain fetch first, Browser Rendering fallback only when needed, without contaminating results with fake homepage content

## Learning objectives

By the end of this phase you can:

- Explain why a plain `fetch()` in a Worker can silently miss a page's real
  content
- Design a cheap heuristic (`looksThin()`) that decides when paying for real
  browser rendering is worth it
- Explain why Browser Rendering's `/markdown` quick action is the right
  choice here, and `/json` was the wrong one
- Recognize and fix a subtle SPA client-routing bug: a "successful" render
  that's secretly just the homepage again

## The problem, first

`fetch()` in a Worker gets exactly what the origin server returns — nothing
more. For a client-side-rendered SPA (Angular/React/Vue without
server-side rendering), whatever content JavaScript injects after the page
loads — entire sections, headings with nothing under them — simply isn't in
that HTML. The real-world symptom that motivated this phase: a `Core
Values` heading on a company's `/careers` page, with none of the actual
values anywhere in the raw HTML a plain `fetch()` saw.

## Walkthrough

1. Read `looksThin()`. A flat character-count minimum isn't reliable — a
   real page can render a couple thousand characters of narrative text via
   plain fetch and still be missing the one section you need. What works:
   comparing extracted-text length to **raw HTML length**. A client-
   rendered SPA shell has a large JS bundle translating to very little
   static text (commonly under 5%); a normal content-heavy page is well
   above that.
2. Read `fetchPageViaBrowserRendering()` — it calls Cloudflare's Browser
   Rendering REST API (`POST .../browser-rendering/markdown`), not a
   Wrangler binding. It needs `CLOUDFLARE_ACCOUNT_ID` (a var) and
   `CLOUDFLARE_API_TOKEN` (a secret — see Phase 3).
3. To actually exercise this phase, you need real credentials:

   ```bash
   wrangler secret put CLOUDFLARE_API_TOKEN
   ```

   and uncomment/set `CLOUDFLARE_ACCOUNT_ID` in `wrangler.toml`. If you
   don't have a Cloudflare account handy for the workshop, `fetchPage()`
   degrades gracefully to plain-fetch-only — read the `canRender` check to
   see how.

## Case study 1: `/json` looked right and failed every time

The first version of `fetchPageViaBrowserRendering()` called Browser
Rendering's `/json` quick action, which renders the page then asks an
internal AI model to extract data matching a prompt. Asking it to hand
back `{ "text": "<everything on the page>" }` failed with `HTTP 422` on
**every single real page tested** — the model generated reasonable content
internally, but couldn't reliably escape several KB of markdown-ish text
(quotes, brackets, colons) into one valid JSON string field, even with a
`response_format` schema supplied.

**The fix:** switch to `/markdown` — a mechanical HTML-to-markdown
conversion with no AI step, so there's no JSON-escaping failure mode to
hit at all. Reserve `/json` for pulling a handful of small, well-defined
fields directly from a page — not as a general "give me all the text"
mechanism.

## Case study 2: the unread response body warning

Watch `wrangler tail` (or your local console) closely and you may see:

> *A stalled HTTP response was canceled to prevent deadlock ... make sure
> to either read the body of every HTTP Response or call
> response.body.cancel()...*

`fetchPagePlain()`'s non-2xx branch returns immediately on a 404 without
touching the response body. With a dozen candidate paths fetched
concurrently (`Promise.allSettled`), several unread bodies can pile up at
once and trip the Workers runtime's concurrent-connection ceiling — this
project's code already includes the fix (`await res.body?.cancel()`), but
now you know why it's there.

## Hands-on lab: the fake-homepage bug

Read `fetchPage()`'s doc comment — it flags a real bug still present in
this phase's starting code.

**The bug:** `fetchPage()` calls `fetchPageViaBrowserRendering()` whenever
the plain-fetch result looks thin — but a 404 from a definitive,
non-existent path *also* "looks thin" (0 characters). So a nonexistent
path like `/mission` (a real 404 from a plain `fetch()`) gets rendered
anyway. Browser Rendering navigates like an actual browser — and many SPA
deployments serve `index.html` (a `200`, the homepage) to a full browser
navigation for **any unmapped route**, so the client-side router can take
over and show its own not-found page. The result: several "successful"
renders that are all silently duplicate copies of the homepage, diluting
the one real page's unique content in the combined AI context. From the
outside this looks like "the AI just won't use the right page" — the
actual cause is several fake pages quietly outvoting the real one.

**Fix it:** in `fetchPage()`, trust a confirmed non-2xx status from the
plain fetch and skip the render fallback entirely for that path.

<details>
<summary>Solution</summary>

```js
async function fetchPage(url, timeoutMs, renderTimeoutMs, env) {
  const plain = await fetchPagePlain(url, timeoutMs);

  // A definitive non-2xx status means the origin itself says this path
  // doesn't exist. Don't "rescue" it with a render — see the case study.
  if (plain.status != null && !plain.ok) return plain;

  const canRender = env?.CLOUDFLARE_ACCOUNT_ID && env?.CLOUDFLARE_API_TOKEN;
  if (!canRender) return plain;
  if (plain.ok && !looksThin(plain.text.length, plain.htmlLength)) return plain;

  const rendered = await fetchPageViaBrowserRendering(url, renderTimeoutMs, env);
  return rendered ?? plain;
}
```

The one-line insight: `plain.status != null && !plain.ok` distinguishes "the
origin gave us a real, honest HTTP error" from "the fetch itself failed at
the network layer" (timeout, DNS — where `status` is `undefined`, and a
render attempt is still worth trying).

</details>

## Checkpoint

Before moving to [Phase 5](../phase-5-diagnostics-debugging/README.md):

- `fetchPage()` skips rendering for a confirmed non-2xx plain-fetch result
- Browser Rendering only engages for a `200` response that looks thin
- You can explain in one sentence why `/markdown` beat `/json` here
