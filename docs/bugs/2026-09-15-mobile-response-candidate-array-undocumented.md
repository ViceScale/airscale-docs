# Bug: Mobile finder response schema omitted additional phone numbers

Date reported: 2026-09-15
Status: implementation verified; publication tracked in related PR
Area: API documentation
Related PR: https://github.com/ViceScale/airscale-docs/pull/32
Related tests: `tests/openapi.test.mjs`, `tests/contracts.test.mjs`, upstream `workers/public-api/v2-waterfall-mobile.multiple-phones.test.mjs`

## User Report

Update the incomplete mobile response schema only.

## Reproduction

The published Mobile finder Markdown and `POST /v1/phone` OpenAPI response schema omit `all_phone_numbers`. The upstream Worker includes it in cached, restricted-provider, and normal result paths. The existing `phone_numbers` field remains the primary scalar string, or null on a miss.

## Root Cause

The docs contract was pinned to an older source revision and retained the original primary-number-only schema after the Worker added its normalized candidate array. The existing exact example assertions also omitted the field.

## Fix

- Add required `all_phone_numbers` to both response variants: a nonempty, unique array of normalized international phone strings on success and an empty array on `not_found`.
- Keep `phone_numbers` as a string on success and null on a miss.
- Show a two-number success example and an empty-array miss example.
- Explain primary-first ordering, deduplication, and singleton results on the Mobile finder page.
- Update only this operation's source evidence to `9bc50ab50731f1793c4ed794776b2fee821d67ca`, including the normalization helper and multiple-phone regression file. Regenerate OpenAPI and the full agent documentation corpus.

## Regression Coverage

Two focused Mobile schema tests failed before the correction and passed afterward. Coverage accepts multi-number and singleton successes and empty misses; rejects absent, null, scalar, empty-success, duplicate, non-phone and numeric candidate values; preserves the scalar primary field; and checks the page guidance. Existing example validation covers the generated OpenAPI artifact.

## Verification

- Original hosted Markdown: `all_phone_numbers` absent.
- Focused Mobile schema red/green: 2 failed before, 2 passed after.
- Upstream multiple-phone suite: 18/18 passed with `--test-isolation=none`. The first isolated attempt encountered a Node test-runner IPC deserialization error; the same tests completed without child-process IPC.
- `npm run validate`: 330/330 tests passed; generated artifacts matched; Mintlify build validation passed.
- Independent review found no blocking issues and independently passed all 53 focused contract/schema tests.
- Structural comparison: `/v1/phone` is the only changed OpenAPI path.
- Post-merge deployment and hosted verification receipts are recorded in the related PR, after Mintlify publishes this commit.

## Watch Later

Keep response examples and both status variants synchronized when phone result fields change. Additional candidate numbers are part of the same result; this change does not alter request inputs, pricing, rate limits, or Worker execution.
