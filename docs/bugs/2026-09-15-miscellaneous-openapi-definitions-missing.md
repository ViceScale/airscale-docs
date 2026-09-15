# Bug: Miscellaneous pages referenced missing OpenAPI operations

Date reported: 2026-09-15
Status: implementation verified; publication tracked in related PR
Area: API documentation
Related tests: `tests/miscellaneous-openapi.test.mjs`, `tests/site.test.mjs`, `tests/openapi-examples.test.mjs`, `tests/contracts.test.mjs`

## User Report

Add the missing OpenAPI definitions for the existing WhatsApp checker, Meta Ads, and Email verifier documentation.

## Reproduction

At docs commit `129d426b3d1ddef1e3cb17bf75e7f9334d7b383d`, each of the three Miscellaneous pages had an OpenAPI frontmatter binding, but the corresponding path was absent from `openapi.json`. The WhatsApp status route documented in prose was also absent. All four new regression tests failed before implementation.

## Root Cause

The pages were added without operation modules or entries in the source-evidence catalog. The wrapper test skipped pages that were not in that catalog, so broken references passed validation.

## Fix

- Add all four operations with request schemas, response examples, authentication, billing, rate limits, errors, and scoped source evidence.
- Include a linked WhatsApp status page within the existing Miscellaneous category.
- Convert the three pages to the existing OpenAPI wrapper pattern, retaining practical retry and billing guidance while the spec supplies request and response reference content.
- Document Meta Ads' 504 timeout, WhatsApp terminal lookup states, and direct/wrapped Email verifier responses.
- Require every authored API page binding to resolve, even if the page is missing from the operation catalog.

## Source and Routing Evidence

Contracts were checked against `ViceScale/airscale-code` revision `282e64878898b4f7082e6ce00b740d76aca787f1`, using the endpoint Worker implementations and tests.

The local Email verifier source handles `/email-verifier`; the existing published documentation uses `/v1/email-verifier`. Anonymous POST probes to both production routes on 2026-09-15 returned HTTP 401 with exactly `{"error":"Missing bearer token"}`. This verifies both auth routes without spending credits; it does not prove authenticated response parity. No Worker or production API configuration was changed.

## Regression Coverage and Verification

- New schema and binding regression tests: 4 failed before, 4 passed after.
- Focused contract/schema/page/example checks: 88/88 passed.
- Source Worker suites: 81/81 passed using `--test-isolation=none`; no paid requests.
- `npm run validate`: 334/334 tests passed, generated artifacts matched, and Mintlify build validation passed.
- Independent review confirmed the corrected verifier passthrough schemas and Meta HTTP 204 wording; no remaining blockers.
- Hosted publication receipts are recorded in the related PR.

## Watch Later

Provider passthrough fields must remain permissive. Keep the catalog, generated spec, page bindings, and source evidence synchronized as operations evolve.
