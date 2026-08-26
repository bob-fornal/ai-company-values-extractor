# Company Values Extractor

A Cloudflare Worker that crawls a company's website and uses Workers AI
(`@cf/meta/llama-3.1-8b-instruct`) to extract its mission, vision, core
values, and culture as structured JSON — optionally with a formatted
markdown report.

## How it works

1. You POST a company URL to the Worker.
2. The Worker fetches a fixed list of likely pages (`/`, `/about`,
   `/careers`, `/values`, etc.), stripping each down to plain text.
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
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "generatedAt": "2026-08-26T00:00:00.000Z",
  "report": "# Company Overview\n..."
}
```

`report` is only present when calling `/extract/full`.

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

| Variable           | Default | Description                                            |
|--------------------|---------|----------------------------------------------------------|
| `MAX_PAGE_CHARS`   | `8000`  | Max characters of crawled text sent to the AI per request |
| `FETCH_TIMEOUT_MS` | `8000`  | Timeout in ms for each candidate page fetch               |

Set as a secret (not in `wrangler.toml`):

| Secret    | Required | Description                                      |
|-----------|----------|---------------------------------------------------|
| `API_KEY` | No       | If set, required via `X-Api-Key` or `Authorization: Bearer` header |
