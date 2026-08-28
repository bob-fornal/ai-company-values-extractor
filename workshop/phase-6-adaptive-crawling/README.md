# Phase 6 — Adaptive Crawling & Job-Listing Follow-Up

**Duration:** 35 minutes
**Builds on:** [Phase 5](../phase-5-diagnostics-debugging/README.md)
**Ends with:** the full feature set — this phase's solved code matches [`../../complete/src/index.js`](../../complete/src/index.js)

## Learning objectives

By the end of this phase you can:

- Explain why a fixed guess list of paths will always miss some real sites
- Scrape a page's own same-origin links to discover its *actual* structure
- Rank discovered candidates so an unbounded nav/footer doesn't become an
  unbounded crawl
- Implement a narrow, targeted "one hop deeper" follow-up (careers page →
  individual job posting)
- Explain why a per-page character floor matters once page count becomes
  variable

## The motivating case

Every debugging session in this workshop so far played out against a site
where most of `RECOMMENDED_PATHS` simply 404'd, while the site's real
navigation (different names entirely — think `/solutions`, `/blog`,
`/contact`) was never guessed at. The actual values content lived only
under `/careers`, with no dedicated `/values` or `/culture` page at all. A
fixed guess list has this failure mode on some real site, always.

## Walkthrough

1. Read `discoverPaths()` — it scrapes the homepage's own same-origin links
   (already extracted by `extractLinksFromHtml()` / `extractLinksFromMarkdown()`
   in Phase 4's fetch functions, just unused until now), filters out
   anything already in `RECOMMENDED_PATHS`, ranks the rest by
   `linkRelevanceScore()`, and caps the result at `MAX_DISCOVERED_PATHS`
   (10).
2. Read `handleExtract()`'s new shape: the homepage is now fetched **first**,
   on its own, specifically so its links are available before the rest of
   the crawl is built. This also keeps it at `crawlResults[0]`, which
   `buildContext()` still depends on.
3. Read `buildContext()`'s new `MIN_OTHER_PAGE_CHARS` floor. Once page count
   is no longer fixed at 12, a strict `(total - homeBudget) / (n - 1)`
   division shrinks every page's share as more get discovered — silently
   reintroducing Phase 5's truncation bug at a larger, variable `n`. A
   floor caps how thin that division is allowed to get.
4. New response fields: `pageStats[].discovery` (`"recommended"` /
   `"root-link"` / `"job-listing"`), `discoveredPaths`, `jobListingPage` —
   the same diagnostics-over-guessing pattern from Phase 5, extended to
   cover *where* each page came from, not just whether it worked.

## Hands-on lab: `findJobListingLink()`

**Motivation:** some companies state their values inside individual job
postings rather than on the careers page itself. If a crawled page's URL
contains `career`, look at that page's own discovered links for one that
points at an individual posting, and fetch it too.

**Your task:** implement `findJobListingLink(careersResult)`, where
`careersResult.links` is an array of absolute, same-origin URL strings.
Return the first link that looks like an individual job posting, or `null`
if none do.

**Two rules for "looks like a job posting":**

1. **Nested under the careers page's own path** — e.g. the careers page is
   `/careers` and the link is `/careers/software-engineer`.
2. **Contains an obvious keyword** — `job`, `position`, `opening`, `apply`,
   or `role` anywhere in the link's path (case-insensitive) — even if it's
   not nested under `/careers` at all (e.g. `/jobs/software-engineer`).

Skip a link that's identical to the careers page's own URL (no path,
trailing slash normalized).

<details>
<summary>Solution</summary>

```js
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
```

**Worked example:** careers page `https://example.com/careers` with links
`["https://example.com/careers/software-engineer", "https://example.com/about"]`
→ returns `"https://example.com/careers/software-engineer"` (nested match).
Careers page `https://example.com/join-us` with links
`["https://example.com/jobs/pm", "https://example.com/team"]` → returns
`"https://example.com/jobs/pm"` (keyword match, not nested — both rules
matter independently).

</details>

## Known limitation worth discussing

Discovered links are deduplicated **by URL**, not by content — a homepage
that links to itself under more than one path (e.g. both `/` and `/home`)
can result in one near-duplicate fetch. This was judged low-cost (redundant
content, not misleading content) against the complexity of content-based
deduplication. Worth asking your table: where's the line between "an
accepted tradeoff" and "a bug we just haven't hit yet"?

## Checkpoint — and workshop wrap-up

Your code should now match [`../../complete/src/index.js`](../../complete/src/index.js).
Run a full extraction against a real company site and inspect every
diagnostic field: `sourcePages`, `pageStats` (with `discovery`),
`skippedPages`, `discoveredPaths`, `jobListingPage`.

**Retrospective takeaways** (see [`../../complete/docs/decision.md`](../../complete/docs/decision.md)
for the full log this workshop was built from):

1. **A symptom can have several stacked causes.** "Values are wrong" was,
   across this workshop, a rendering problem, a leaked-credential problem,
   a stale deploy, an unset config value, a wrong API endpoint choice, an
   unread response body, an SPA-routing edge case, a config-drift problem,
   and a budget/truncation problem — in sequence. Each fix was necessary
   but not sufficient on its own.
2. **Diagnostics beat guessing.** Code review alone repeatedly failed to
   find the actual root cause. Real logging and response-level diagnostics
   found each one in a single round-trip once they existed.
3. **Reproduce outside the system under test when possible.** A direct
   `curl` against the target site ruled out "is this the Worker's fault"
   faster than redeploying and re-testing the Worker itself.
4. **Config drift is a real failure mode.** Not everything wrong with a
   deployed system is a code bug — some of it is process.
5. **A fixed guess list will always miss some sites.** Scraping a site's
   actual structure catches what a static list can't.

For further reading beyond this workshop, see
[`../../complete/docs/cloudflare-skill.md`](../../complete/docs/cloudflare-skill.md) —
the reusable, project-agnostic lessons extracted from this same debugging
history.
