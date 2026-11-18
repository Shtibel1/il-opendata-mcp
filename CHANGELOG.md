# Changelog

## 0.5.0 — 2026-11-18

- In-memory TTL cache for CKAN GET responses (default 5 minutes, `--cache-ttl` / `IL_OPENDATA_CACHE_TTL`, `0` disables). Concurrent identical requests share one call, errors are never cached, max 256 entries.
- The stateless HTTP mode shares one cached `CkanClient` across all requests; `createServer()` accepts an existing `CkanClient`.
- MCP resources: `opendata://featured`, `opendata://organizations` and the `opendata://dataset/{name}` template (featured datasets listed, name completion, validated names).
- `GET /healthz` and the User-Agent now report the version from a single `src/version.ts`.

## 0.4.0 — 2026-11-13

- `list_organizations` tool and an `organization` filter for `search_datasets`.

## 0.3.0 — 2026-11-10

- Docker image, `ALLOWED_ORIGINS` env and Render one-click deploy.

## 0.2.0 — 2026-11-09

- Stateless Streamable HTTP transport (`--http`) with health check and origin guard.

## 0.1.0 — 2026-11-08

- Initial release: `search_datasets`, `get_dataset`, `describe_resource`, `search_records`, `list_featured_datasets`.
