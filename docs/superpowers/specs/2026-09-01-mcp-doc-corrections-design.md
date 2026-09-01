# MCP Documentation Corrections Design

## Goal

Correct the seven non-domain MCP documentation problems identified in the September 1 audit, deploy the narrow documentation release, and leave the existing Framer/Mintlify domain boundary unchanged.

## Scope

- Add the missing `airscale_create_contact_enrichment_batch` step before contacts are added.
- Describe the documentation MCP as documentation-scoped, not wholly read-only, because `submit_feedback` writes feedback.
- Stop advertising Mintlify's incomplete generated server card as an exact tool directory.
- Make every generated paid-export example a non-executing spend preview by omitting `confirm_credit_spend: true`.
- Give documentation-MCP users real Airscale filesystem paths and tell them to discover paths with `tree` rather than trusting Mintlify's generic nonexistent examples.
- Tell agents to use endpoint prose or `openapi.json` when Mintlify flattens alternative request schemas into repeated/conflicting fields.
- State that `poll_after_seconds` is present only while an export is queued or running.

## Boundaries

- Do not change DNS, custom domains, canonicals, indexing, redirects, or the Framer site.
- Do not change the operational Airscale MCP server or its tool schemas.
- Do not author a replacement `/.well-known/mcp/server-card.json`; Mintlify owns that generated endpoint.
- Do not execute paid Airscale tools during validation.

## Implementation

Source-authored pages and generated agent files will carry the corrected contract. The catalog generator will emit safe preview calls for paid starts and describe the intentional `credit_confirmation_required` response. Tests will assert the complete managed-batch order, the documentation-MCP mutation boundary, removal of the stale server-card advertisement, real filesystem guidance, safe paid examples, and conditional polling.

Mintlify-controlled help text cannot be overridden by `docs.json`. The source-side mitigation is to publish authoritative Airscale-specific path guidance and stop advertising the incomplete server card as an exact resource. Hosted verification will separately record the remaining vendor-generated behavior.

## Verification

- Focused red/green tests in `tests/mcp-pages.test.mjs` and `tests/mcp-generation.test.mjs`.
- Exact-byte generator checks and the full `npm run validate` suite.
- Exact GitHub SHA and successful deployment check.
- Hosted checks for all six MCP routes, generated agent files, safe examples, documentation-MCP `tools/list`, and a no-spend filesystem query.

