# Phase 1 — Project Setup & Health Check

**Duration:** 30 minutes
**Builds on:** nothing (starting point)
**Ends with:** a deployed Worker that responds to `GET /`

## Learning objectives

By the end of this phase you can:

- Explain what each field in `wrangler.toml` does (`name`, `main`,
  `compatibility_date`, `compatibility_flags`, `workers_dev`, `preview_urls`)
- Run a Worker locally with `wrangler dev` and deploy it with `wrangler deploy`
- Add a routed endpoint and a JSON response helper
- Explain why `workers_dev`/`preview_urls` should be set explicitly (a real
  warning you'll hit on your first deploy)

## Why this shape?

Every later phase adds behavior to the same `fetch()` handler — routing on
`url.pathname` and `request.method` inside one `try/catch`, with a shared
`jsonResponse()` helper and `CORS_HEADERS` constant. Get comfortable with
this skeleton now; nothing about its shape changes later, only what's
inside it.

## Walkthrough

1. Install Wrangler if you haven't: `npm install -g wrangler`
2. From this folder, run:

   ```bash
   wrangler dev
   ```

3. In another terminal:

   ```bash
   curl http://localhost:8787/
   ```

   You should get back a JSON health-check body.
4. Try an unknown path — `curl http://localhost:8787/nope` — and confirm you
   get a `404` with `{"error": "Not found"}`.
5. Deploy it: `wrangler deploy`. Watch the output — if you see warnings about
   `workers_dev` or `preview_urls`, that's exactly the config-warning case
   study below.

## Case study: the config warning that isn't a bug

The very first thing anyone hits deploying a Worker is two warnings about
`workers_dev` and `preview_urls` not being set explicitly in
`wrangler.toml`. Wrangler silently defaults both to `true` — the warning is
purely about being explicit, not a functional problem. This project sets
both explicitly for exactly that reason. It's a good first lesson: **not
every warning is a bug, but silencing a known-safe one is still worth doing**
so real warnings don't get lost in noise later.

## Hands-on lab

Add a second endpoint, `GET /version`, that returns:

```json
{ "version": "1.0.0-phase1" }
```

**Constraints:**
- Reuse `jsonResponse()` — don't hand-roll another `new Response(...)`.
- It must return `404` for any other unmatched path, same as today.

<details>
<summary>Solution</summary>

```js
if (url.pathname === "/version" && request.method === "GET") {
  return jsonResponse({ version: "1.0.0-phase1" });
}
```

Add this alongside the existing `/` route inside the `try` block, before the
final `return jsonResponse({ error: "Not found" }, 404);`.

</details>

## Checkpoint

Before moving to [Phase 2](../phase-2-ai-extraction/README.md), you should
have a Worker deployed (or running locally) that:

- Responds to `GET /` with a health-check JSON body
- Returns `404` for unknown paths
- Handles `OPTIONS` for CORS preflight
