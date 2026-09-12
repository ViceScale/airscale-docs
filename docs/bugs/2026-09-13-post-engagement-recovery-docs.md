# Bug: Post engagement documentation omitted deployed recovery behavior

Date reported: 2026-09-13
Status: fixed locally
Area: API documentation
Related PR: Airscale code PR #1185
Related tests: `tests/openapi.test.mjs`, `tests/site.test.mjs`, `tests/contracts.test.mjs`, `tests/openapi-examples.test.mjs`, `tests/documentation-pages.test.mjs`

## Reproduction

The published Post likers and Post commenters pages had no `Idempotency-Key`, `202 page_pending`, `409` replay handling, account restart guidance, or retrieval metadata. Both still described lost-response retries without the new safe recovery option. OpenAPI parameters were empty.

## Root Cause

The API recovery release was published from `9a539d40c2d5786cd064ce1637f93d6e020ef317`, but the separate Mintlify repository retained its September 11 contract. Earlier tests explicitly prohibited the now-supported public retry header.

## Fix

Document per-page UUID keys, identical-request retries, unconfirmed pending outcomes, replay conflicts, expiry, retained reservations, account restart and incomplete provider coverage. Model pending/error responses and optional retrieval metadata in OpenAPI. Request examples retain a caller-supplied page key; they never generate a new key silently on retry. Correct the upfront reservation to the requested limit, refund unused slots, and give the one-success/limit-25 example 24 refunded credits. Add dashboard recovery guidance and pin only the two changed operation contracts to the deployed source SHA.

## Regression Coverage

The updated contract tests failed against the old docs and generator, then passed after correction. They require the optional UUID header, pending response fields and delay, correct retry examples, retrieval schema, scoped source identity, accurate unused-slot refunds, and the distinct retry/restart instructions. Generated examples are validated against the OpenAPI schemas by the existing full suite.

## Verification

- Baseline `npm test`: 325/325 passed.
- Updated recovery contract tests: failed before implementation, passed after implementation.
- Final `npm run validate`: 326/326 tests passed; generated OpenAPI, MCP and agent artifacts matched; Mintlify build validation passed.
- Desktop (1440px) and mobile (390px) browser checks passed for both API pages and the dashboard guide: HTTP 200, recovery text rendered, no page errors or horizontal document overflow. Screenshots reviewed.
- The original dashboard guide snapshot remains intact outside the added recovery section; a dedicated test covers recovery boundaries and API links.
- Publication and live verification evidence will be recorded in the release handoff.
