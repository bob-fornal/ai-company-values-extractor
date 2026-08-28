# Phase 3 — Securing the Endpoint

**Duration:** 25 minutes
**Builds on:** [Phase 2](../phase-2-ai-extraction/README.md)
**Ends with:** `/extract` and `/extract/full` protected by an optional `API_KEY`, both endpoints working

## Learning objectives

By the end of this phase you can:

- Explain the difference between a `[vars]` entry and a Wrangler secret
- Protect a route with an optional API key check (open by default, locked
  down once a secret is set)
- Explain why `GET /` should stay unprotected even when other routes aren't
- Set, list, and rotate a secret without ever seeing its value in a terminal

## Walkthrough

1. Look at `isAuthenticated`'s inline logic inside `handleExtract()` — it
   only runs the check `if (env.API_KEY)`. No key configured means no
   check at all; this is deliberate so the workshop (and any fresh clone)
   works out of the box.
2. Note that `GET /` never touches this check — a health check needs to
   stay reachable for uptime monitoring regardless of how the rest of the
   API is locked down.
3. `/extract/full` is new this phase — same crawl and extraction as
   `/extract`, plus a second `AI.run()` call (`generateReport()`) that
   turns the structured JSON into a markdown report.
4. Try it unprotected first:

   ```bash
   wrangler dev
   curl -X POST http://localhost:8787/extract/full \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}'
   ```

## Case study: the token that leaked in plain sight

This one didn't happen to `API_KEY` — it happened to a *different*
credential (`CLOUDFLARE_API_TOKEN`, added in the next phase) — but the
lesson applies to every secret in this project, including the one you're
about to set.

**What happened:** an API token was pasted into `wrangler.toml` under
`[vars]` (or added as a plaintext "Variable" in the Cloudflare dashboard —
same mistake, different UI). The very next `wrangler deploy` printed the
literal token value in its config-diff output — because `wrangler` only
ever prints plaintext var values when local config differs from what's
live. A real Secret is always masked in that same diff.

**The fix:** revoke the exposed token immediately (it's compromised the
moment it hits terminal scrollback or a CI log), then set it properly:

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
```

**Rule of thumb:** if a config value is a credential, it's a secret, never
a var — even "just for testing locally." `[vars]` is plaintext, full stop:
visible in the dashboard, and printed in cleartext on every diffing deploy.

## Hands-on lab

1. Set an API key as a secret:

   ```bash
   wrangler secret put API_KEY
   ```

2. Confirm it's protecting the endpoint:

   ```bash
   # No key — should now 401
   curl -i -X POST http://localhost:8787/extract \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}'

   # With the key — should succeed
   curl -X POST http://localhost:8787/extract \
     -H "Content-Type: application/json" \
     -H "X-Api-Key: <the value you set>" \
     -d '{"url": "https://example.com"}'
   ```

3. Confirm `GET /` **still** works with no key at all.
4. List your configured secrets (values are never shown):

   ```bash
   wrangler secret list
   ```

<details>
<summary>Solution / expected behavior</summary>

- No `API_KEY` secret set → every request succeeds (auth check is a no-op)
- `API_KEY` set, no header/wrong header → `401 Unauthorized`
- `API_KEY` set, correct `X-Api-Key` or `Authorization: Bearer <key>` header
  → succeeds
- `GET /` → always succeeds, with or without a key

If step 2's authorized request still 401s, double check you're sending the
header name Wrangler expects (`X-Api-Key`, case-insensitive) and that the
value has no trailing newline from how you set the secret.

</details>

## Checkpoint

Before moving to [Phase 4](../phase-4-js-rendered-pages/README.md):

- `/extract` and `/extract/full` both respect `API_KEY` when it's set
- `GET /` is never gated
- You can explain, without looking it up, why a credential belongs in
  `wrangler secret put`, never `[vars]`
