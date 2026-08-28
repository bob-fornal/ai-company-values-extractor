# Phase 5 — Diagnostics, Config Drift & the Truncation Bug

**Duration:** 35 minutes
**Builds on:** [Phase 4](../phase-4-js-rendered-pages/README.md)
**Ends with:** `pageStats`/`skippedPages` diagnostics in the response, and a context budget that gives the homepage a fair (not crowding-out) share

## Learning objectives

By the end of this phase you can:

- Explain why "the page appears in `sourcePages`" doesn't prove it
  contributed real content
- Add response-level diagnostics that turn "is this working?" into
  something callable, not something you have to guess at from logs
- Recognize config drift as a process failure mode, not a code bug
- Diagnose and fix a silent truncation bug in a shared character budget

## Walkthrough

1. Run an extraction and look at the new `pageStats` and `skippedPages`
   fields in the response:

   ```bash
   wrangler dev
   curl -X POST http://localhost:8787/extract \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}' | jq '.pageStats, .skippedPages'
   ```

2. `pageStats[].source` tells you `"plain"` vs `"browser-rendering"` per
   page — this is the field that would have made two real incidents (below)
   obvious in seconds instead of hours.

## Case study: two bugs that diagnostics — not code review — actually found

**"`/careers` disappeared from `sourcePages` entirely."** Code review
didn't surface an obvious cause; the fallback logic looked like it should
always degrade gracefully. The real root cause, found via `git diff`, not
logs: `wrangler.toml` had picked up an invalid `[[rules]]` block (most
likely from an edit made directly in the Cloudflare dashboard's file
editor), which was failing config validation — meaning **`wrangler
deploy` had been failing silently**, and the live Worker was running stale
code the whole time, unrelated to whatever the current source said.

**"`/careers` is present, but the values are still from the homepage."**
Being present in `sourcePages` doesn't distinguish "got real rendered
content" from "silently fell back to thin plain-fetch content" — both look
identical from the outside. `wrangler tail` eventually showed *"Browser
Rendering not configured"* for every page: `CLOUDFLARE_ACCOUNT_ID` had
never actually been set — it was still commented out with a placeholder.

**The lesson in both:** guessing from code review alone repeatedly missed
the actual cause. Real logging plus response-level diagnostics
(`pageStats`, `skippedPages`) found each root cause in one round-trip once
they existed. This is why they're in the response now, not just in logs.

## Discussion: config drift

Separately, `CLOUDFLARE_ACCOUNT_ID` was later found reverted back to unset
between working sessions — traced via `git diff` to `wrangler.toml` being
hand-edited outside the normal deploy flow (again, likely the dashboard's
own file editor). Worth raising with your table: **is this a code problem
or a process problem?** (It's the latter — no amount of defensive code
fixes a config file someone else keeps editing out from under you. Two
real mitigations: commit the working config to git for a clear change
history, or move volatile-but-not-secret values like this into a secret so
a stray local edit can't silently unset them.)

## Hands-on lab: the truncation bug

**Symptom:** with the SPA-fallback contamination from Phase 4 fixed and
credentials stable, the crawl is finally clean — yet the extracted
`values` are *still* the homepage's, not `/careers`'s.

**Investigate:** with `MAX_PAGE_CHARS = 8000` and (say) 4 successful pages,
what's each page's character budget under `buildContext()`'s **strict
even split**? Now go measure (or estimate) roughly how far into
`/careers`'s Browser-Rendered markdown the real "Our Core Values" section
sits — remember it carries extra overhead a plain-fetched page doesn't:
nav links rendered as full `[Label](url)` syntax, a title/description
frontmatter block, a logo image reference.

**Fix it two ways:**

1. Raise `MAX_PAGE_CHARS` in `wrangler.toml` from `8000` to `30000`.
2. In `buildContext()`, give the homepage a modest head start instead of
   an equal share — every other page needs enough room to get past its own
   nav/frontmatter overhead before reaching real content.

<details>
<summary>Solution</summary>

```js
function buildContext(crawlResults, maxTotalChars) {
  const successful = crawlResults.filter((r) => r.ok && r.text.length > 0);
  if (successful.length === 0) return "";

  // Homepage gets 25% of the budget; everyone else splits the rest evenly.
  const homeBudget = Math.floor(maxTotalChars * 0.25);
  const otherBudget = Math.floor(
    (maxTotalChars - homeBudget) / Math.max(1, successful.length - 1)
  );

  const chunks = successful.map((r, i) => {
    const budget = i === 0 ? homeBudget : otherBudget;
    const snippet = r.text.slice(0, budget);
    return `--- PAGE: ${r.url} ---\n${snippet}`;
  });

  return chunks.join("\n\n");
}
```

This relies on the homepage being `crawlResults[0]` — true here because
`"/"` is always first in `RECOMMENDED_PATHS`, and `Promise.allSettled`
preserves input order in its results array even though the fetches run
concurrently.

**Why 25%, not 40% or 50%?** The original budget gave the homepage a much
larger head start; rebalancing to 25% freed up meaningfully more room for
every other page without starving the homepage either. There's no single
"correct" number here — it's a tuning tradeoff worth discussing with your
table.

</details>

## Checkpoint

Before moving to [Phase 6](../phase-6-adaptive-crawling/README.md):

- `MAX_PAGE_CHARS` is `30000`
- The homepage gets a fixed 25% share; other pages split the rest evenly
- `pageStats` and `skippedPages` appear in every extraction response
