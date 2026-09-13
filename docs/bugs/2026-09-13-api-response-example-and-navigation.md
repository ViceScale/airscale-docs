# Bug: Email finder response example omits documented fields

Date reported: 2026-09-13
Status: fixed
Area: documentation UI
Related issue: User screenshot and API navigation request
Related PR: https://github.com/ViceScale/airscale-docs/pull/29
Related tests: tests/api-reference-presentation.test.mjs; tests/openapi-examples.test.mjs; tests/openapi.test.mjs; tests/site.test.mjs

## User Report

The Email finder response schema on the left is correct, but its right-hand example is incomplete. Include Count within Find people rather than as a separate sidebar item; put Account first, Post engagement after Profiles and reverse lookup and make it expandable, and put Miscellaneous last.

## Reproduction

On https://airscale.mintlify.app/api-reference/email-finder, inspect the successful response. Chrome DevTools reproduced seven schema fields, while both rendered example copies contained only `status` and `email`. The API sidebar exposed Count people separately, put Post engagement above Contact data, and ended with Account.

## Root Cause

`emailResultContent` in `openapi/operations/contact-data.mjs` supplied an explicit two-field example. Mintlify used that example instead of deriving a complete one from `SuccessEmail`. Existing schema validation accepted it because the other fields are optional. Privacy checks also disallowed all string provider/verifier examples, including harmless placeholders. The sidebar order came from `docs.json`, and the existing collapse script only handled two section titles.

## Fix

- Complete the explicit success example with all seven existing schema fields, including exact `<provider>` and `<verifier>` placeholders. Preserve the schema and the not-found example.
- Include the count endpoint, its shared query/auth requirements, free cost, rate limit, and request/response examples under Find people. Keep the old Count URL available for existing links but remove it from navigation.
- Reorder the API groups and extend the existing accessible collapse control to Post engagement.
- Regenerate the OpenAPI document and LLM indexes. Update navigation fixtures to select the actual overview page and a still-navigable nested page for the symlink check.

## Regression Coverage

`tests/api-reference-presentation.test.mjs` failed on all three requested behaviors before the fix and passed afterward. It compares example keys to the actual success schema, validates its values, checks sidebar priority, and validates inline Count examples against the count operation. Existing safety checks continue rejecting real provider identities and arbitrary non-null labels; only exact public-field placeholders are allowed.

Manual browser smoke: load Email finder at desktop width and compare schema/example fields; load Find people, expand Count request and response to view both examples, and open/close Post engagement. Confirm Account is first, Miscellaneous last, Count absent from the sidebar, the legacy Count URL still loads, and no document overflow at a 390px mobile viewport.

## Verification

- `node --test tests/api-reference-presentation.test.mjs`: 3 expected failures before implementation; 3 passes afterward.
- `node --test tests/api-reference-presentation.test.mjs tests/site.test.mjs tests/openapi.test.mjs tests/openapi-examples.test.mjs`: 81 passed, 0 failed.
- `npm run openapi:check && npm run mcp:check && npm run agents:check`: passed.
- `npx mint validate`: OpenAPI and build validation passed.
- Chrome local preview at port 3107: complete seven-field email example; exact group order; Post engagement initially hidden, both links visible after expansion, hidden again after collapse; Count request and response rendered inline; legacy `/api-reference/find-people/count` loaded; 390px document width matched viewport width; no warning/error console messages on the two edited pages.
- `node --test --test-concurrency=1 --test-timeout=180000 tests/*.test.mjs`: 329 passed, 0 failed, 0 cancelled (91.2 seconds).
- After simplifying the Count accordion, the focused five-file suite passed 101 tests and the generated-index check passed.
- Hosted publication verification pending at the time of this entry.

## Watch Later

Mintlify top-level collapsible groups use the site's existing DOM adapter; retain browser smoke coverage when upgrading Mintlify. Optional response fields need example coverage even when JSON Schema permits omission. Keep the inline Count samples validated against OpenAPI when changing its contract.
