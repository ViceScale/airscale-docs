# Endpoint rate limits were easy to miss

## Report and reproduction

The user could not find the 6 requests/second limits for Find people and Find companies on the migrated Mintlify documentation. Browser inspection of the live Find people page confirmed that the limit existed in the MDX body, below request/response examples, while the page header omitted it. The custom OpenAPI `x-airscale-rate-limit` extension was present but did not automatically produce a visible header limit.

## Change

Expose each of the 25 published operations' existing rate-limit statements in the page description, directly below the title. Add a linked table on the Rate limits guide, preserving workspace scope, shared route allowances and the bulk email input-item unit. Preserve the distinction between undocumented limits and endpoints without a dedicated throttle. No runtime limits or API contracts change.

## Regression coverage

`tests/api-reference-presentation.test.mjs` checks every operation's visible header description and the linked rate-limit overview against its existing OpenAPI rate-limit metadata. The new test failed before the content change and passes afterward.

## Verification

Focused presentation tests: 4 passed, including the failing-before/passing-after header check. Documentation/contract tests: 255 passed. OpenAPI, MCP and agent-file freshness checks passed. Source and generated production Mintlify builds passed. The unchanged MCP generator file-lock suite was excluded because it stalled in the preceding release investigation; a full-suite green result is not claimed. Hosted browser verification is recorded in the private release receipt after publication. Manual smoke: open Find people and Find companies on desktop/mobile, verify 6 requests per second per workspace immediately below the title, follow the Rate limits guide, and confirm hidden job-change pages stay absent.
