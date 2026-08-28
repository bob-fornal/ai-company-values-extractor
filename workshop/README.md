# Workshop: Building a Production Cloudflare Worker

A hands-on, 4-hour, six-phase workshop that builds the
[Company Values Extractor](../complete/README.md) — a Cloudflare Worker
that crawls a company website and uses Workers AI to extract its mission,
vision, values, and culture — from an empty `wrangler.toml` up to the full
implementation in [`../complete`](../complete).

Every phase is built around a **real incident** from the project's own
[decision log](../complete/docs/decision.md) — this isn't a synthetic
curriculum, it's the actual debugging history turned into a teaching
sequence. Each phase folder is a runnable checkpoint: starting code, a
README with objectives + case study + hands-on lab (with solution), and a
`wrangler.toml`.

## Format

- **Audience:** developers comfortable with JavaScript who are new to
  Cloudflare Workers, or want a structured tour of building + debugging a
  real AI-backed Worker.
- **Prerequisites:** Node.js, a Cloudflare account with Workers AI enabled,
  `npm install -g wrangler`. Phase 4 onward benefits from Browser Rendering
  credentials, but degrades gracefully without them (see that phase's
  README).
- **Slides:** [`slides/`](slides/) — the accompanying PowerPoint deck,
  one section per phase plus intro/wrap-up.

## Agenda (4 hours)

| Time | Segment | Duration |
|------|---------|----------|
| 0:00–0:10 | Welcome & workshop overview | 10 min |
| 0:10–0:40 | [Phase 1 — Project Setup & Health Check](phase-1-project-setup/README.md) | 30 min |
| 0:40–1:15 | [Phase 2 — Crawling & AI Extraction](phase-2-ai-extraction/README.md) | 35 min |
| 1:15–1:40 | [Phase 3 — Securing the Endpoint](phase-3-securing-endpoint/README.md) | 25 min |
| 1:40–1:50 | Break | 10 min |
| 1:50–2:30 | [Phase 4 — Handling JavaScript-Rendered (SPA) Pages](phase-4-js-rendered-pages/README.md) | 40 min |
| 2:30–3:05 | [Phase 5 — Diagnostics, Config Drift & the Truncation Bug](phase-5-diagnostics-debugging/README.md) | 35 min |
| 3:05–3:15 | Break | 10 min |
| 3:15–3:50 | [Phase 6 — Adaptive Crawling & Job-Listing Follow-Up](phase-6-adaptive-crawling/README.md) | 35 min |
| 3:50–4:00 | Retrospective & Q&A | 10 min |

## What each phase adds

| Phase | Adds | Real incident behind it |
|-------|------|--------------------------|
| 1 | `wrangler.toml`, health check, routing skeleton | Deploy config warnings |
| 2 | `POST /extract`, fixed-path crawl, Workers AI call | `response.response` `TypeError` |
| 3 | `API_KEY` auth, `/extract/full` report generation | Leaked API token via `[vars]` |
| 4 | Browser Rendering fallback for JS-rendered pages | SPA content missing; `/json` 422s; fake-homepage renders |
| 5 | `pageStats`/`skippedPages` diagnostics, budget fix | Silent stale deploy; unset credentials; context truncation |
| 6 | Adaptive homepage-link discovery, job-listing follow-up | Fixed guess list missing a real site's actual structure |

## Running any phase

Each phase folder is self-contained:

```bash
cd phase-N-<name>
wrangler dev
```

```bash
curl -X POST http://localhost:8787/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Phase 1 only has `GET /`. From Phase 2 onward, `POST /extract` (and, from
Phase 3, `POST /extract/full`) are available.

## Facilitator notes

- Every phase's starting code has exactly one intentional gap (a bug to
  fix or a function to implement) tied to that phase's case study — the
  solution is in a `<details>` block in the README, collapsed by default so
  attendees can attempt it first.
- Case studies without a code lab (config drift in Phase 5, the known
  link-dedup limitation in Phase 6) are discussion prompts — there's no
  single "correct" fix, and that's the point.
- The reference solution for the entire workshop is
  [`../complete`](../complete), with the full incident-by-incident history
  in [`../complete/docs/decision.md`](../complete/docs/decision.md) and
  reusable, project-agnostic lessons in
  [`../complete/docs/cloudflare-skill.md`](../complete/docs/cloudflare-skill.md).
- `.env`-style secrets should never be committed or projected on screen —
  use `wrangler secret put` live instead of pre-filled values.
