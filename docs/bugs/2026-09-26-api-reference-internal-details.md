# Bug: API reference exposes internal choices and confuses documentation with product branding

Date reported: 2026-09-26
Status: fixed locally
Area: other
Related issue: User request
Related PR: Not created yet; local documentation branch docs/user-facing-api-reference.
Related tests: tests/api-reference-presentation.test.mjs; tests/site.test.mjs; tests/openapi.test.mjs

## User Report

The documentation brand should be Airschool with the existing icon. The product and its keys remain Airscale. Users should submit a LinkedIn URL without choosing p1/p2/p3. Remove internal provider and billing narratives while retaining useful integration guidance.

## Reproduction

Opened https://docs.airscale.io/api-reference/extract-people-profile in Chrome. The page displayed the Airscale wordmark, Airschool workspace API key copy, and mode enum p1/p2/p3 in both prose and generated Body fields.

## Root Cause

The site SVG wordmarks and docs.json used product branding while API prose and OpenAPI used the documentation name for the product. OpenAPI request schemas and examples exposed internal extraction choices. Copy-focused tests enforced these older choices.

## Fix

Changed light/dark wordmarks and site identity to Airschool while retaining the original symbol. Corrected API MDX/OpenAPI product terminology to Airscale. Removed public mode documentation and examples. Simplified field descriptions, provider orchestration, internal field-removal details, and billing recovery text. Retained variable response shapes, error codes, costs, pagination, timeouts, idempotency, and uncertain-charge caveats. Regenerated openapi.json and agent-readable documents.

## Regression Coverage

Presentation tests cover URL-only request schemas/examples, branding separation, optional result fields, and retained retry/billing limits. Existing SVG tests verify that the icon geometry is unchanged. Existing schema fixtures still cover variable, wrapped, and unstructured responses. Existing prose assertions now check user-facing equivalents.

## Verification

`npm run validate` passed: 357 tests, OpenAPI/MCP/agent artifact checks, and Mintlify build validation. After final copy corrections, the 28 presentation/site tests and agent artifact consistency check passed again. `git diff --check` passed. A structural OpenAPI comparison found only the intended extraction-mode removal; other request/response shapes, paths, examples, and rate limits are unchanged. Read-only review caught an overly broad expired-cursor sentence, corrected to require already-saved page results and covered by a regression assertion.

Browser preview at http://localhost:3346/api-reference/extract-people-profile shows Airschool wordmark, Airscale API key description, and only linkedin_profile_url in the request body. The company-profile and verifier pages were also inspected. Light and dark screenshots confirmed the full Airschool wordmark fits beside the original icon. No API requests or paid lookups were run.

## Watch Later

Removing mode from public documentation does not remove runtime support. Default profile fields still vary, and verifier response shapes remain permissive. Publishing these edits is separate from local verification.
