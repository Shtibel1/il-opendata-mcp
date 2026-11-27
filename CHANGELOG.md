# Changelog

## 0.6.0 — 2026-11-27

- `count_records` tool: exact record count for `q`/`filters` without downloading rows (`datastore_search` with `limit=0`), with an optional `group_by` breakdown (up to 25 values of one field, 4 requests in parallel) returning each count, its share of the total and the remainder.
- `list_field_values` tool: sorted distinct values of one field (`distinct=true`), optionally under `q`/`filters`, with `total_distinct`, `has_null` and a `complete` flag. data.gov.il applies the row limit before DISTINCT on large resources, so partial lists are flagged instead of passed off as complete.
- `search_records` gains `sort` (up to 5 keys, quoted identifiers) and multi-value filters: `{ "tozeret_nm": ["טויוטה יפן", "מאזדה יפן"] }` matches any of them. Filters also accept numbers and booleans.
- Field names in `sort`, `filters`, `group_by` and `list_field_values` are validated before CKAN is called.
- data.gov.il answers invalid datastore queries with an HTML 404; the error now says so and points at `describe_resource` and the field names.

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
