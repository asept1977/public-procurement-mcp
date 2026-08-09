# Public Procurement MCP

Neutral Model Context Protocol server for researching public procurement notices. It currently integrates:

- TED Search API for EU notices
- Datenservice Öffentlicher Einkauf (DÖE) daily CSV exports for German notices

The server deliberately contains no K2 Systems, KIO, InterFace AG, solar, AI-platform or software-development scoring logic. Those preferences belong in the calling agent or skill so the MCP remains reusable.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_sources` | Show source coverage and constraints |
| `search_notices` | Search and normalize notices from TED, DÖE or both |
| `get_notice` | Retrieve a notice by its source identifier |
| `get_document_links` | Return document/source links without downloading files |
| `inspect_german_export` | Inspect one daily DÖE CSV ZIP export |

Advanced TED searches can pass an unmodified `expert_query`. DÖE is a daily bulk export, so calls require publication dates.
Country filters use the three-letter TED/eForms codes, for example `DEU`, `AUT` or `CHE`. DÖE date ranges are capped at three days by default to stay within demo memory limits; configure `MAX_DOE_DAYS` for a larger service.

## Run locally

```bash
npm ci
MCP_AUTH_TOKEN=replace-me npm start
```

- Health: `GET http://localhost:3000/status`
- MCP: `POST http://localhost:3000/mcp`
- Auth: `Authorization: Bearer <MCP_AUTH_TOKEN>`

If `MCP_AUTH_TOKEN` is empty, auth is disabled. Set `DEMO_MODE=true` for a deterministic synthetic result without upstream requests.

## Deploy to Render

The included `render.yaml` and `Dockerfile` deploy the service in Frankfurt. Render generates `MCP_AUTH_TOKEN`; copy that value into the MCP client configuration after deployment.

## Output compatibility

Every tool returns MCP `structuredContent` and mirrors the complete JSON object in the first text content block for clients that consume only text results.

## Data-source note

TED and DÖE can contain overlapping notices. The combined search prefers a shared TED publication number when DÖE exposes it and otherwise preserves source-specific IDs. Source terms, rate limits and availability remain authoritative.
