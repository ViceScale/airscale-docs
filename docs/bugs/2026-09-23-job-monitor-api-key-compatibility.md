# Job-change monitor docs omit the V2 API-key requirement

Date: 2026-09-23
Area: Public API documentation and authentication scope

## Reproduction and cause

The general authentication guide described a workspace API key without distinguishing V1/Bubble from V2. The nine documented job-change monitor pages inherited that wording. The user asked whether V1 keys could use these endpoints.

The public Worker forwards the supplied key as X-Airscale-Workspace-Key to the coded API. api/src/routes/publicJobChangeMonitors.ts resolves it only against workspaces.apiKey; it contains no Bubble workspace lookup. The monitor service and credits are scoped to that V2 workspace. This differs from other Workers that support Bubble-first authentication.

## Change

Clarify the V2 workspace-key requirement and lack of V1/Bubble-key support on all nine monitor pages, in the authentication guide, and in OpenAPI operation descriptions. No authentication, billing, monitoring, Worker deployment, or backend behavior is changed. Separately, remove the user-requested documentation-corrections page, navigation entry, incoming link, and generated discovery content.

## Verification

- Current job-change Worker deployment: b844281d-d49e-4c51-bf9a-33d6c26dbfb6, release tag 25a9027a. Its tagged source file hash matches the reviewed Worker source. Wrangler confirms the Render upstream, internal-key binding, and rate-limit KV binding.
- Worker tests: 7/7 passed. API router and public contract test files: 2/2 passed.
- Additional local audit exercised all nine documented route handlers against mocked services with the expected success statuses; unknown workspace keys were rejected for all nine. This is not a real Bubble-key canary or a paid end-to-end monitoring test.
- Live no-spend GET /v1/job-change-monitors: missing credentials returned 401; an invalid bearer reached the upstream and returned invalid_api_key/401. Render health returned ok=true.
- Documentation regressions require the V2 limitation on every monitor wrapper, removal from publication/navigation, and the revised API-page count. The initial full documentation run caught the old 38-page count; it was changed to 37 after removal.

## Mark-read request-body mismatch

The API router accepts mark-read without reading a body, but the public Worker requires nonempty valid JSON on every POST. The published OpenAPI marked this operation as bodyless, so generated requests failed before reaching the route. Live probes with an intentionally invalid key and synthetic IDs returned 400 Invalid JSON without a body and invalid_api_key/401 with `{}`. Neither request authenticated or changed an event.

Require an empty JSON object in this operation's OpenAPI and explain it on the page. The existing request-body/example contract test failed when mark-read was removed from its bodyless allowlist, before the schema fix. The full docs validation and hosted checks are recorded in the release receipt. Backend and Worker behavior remain unchanged.

Live scheduled provider checks and webhook delivery have not been certified by this audit. V1 support requires a separate backend/authentication/billing design; changing examples alone would not enable it.
