# Bug: Work-email input tabs look like mutually exclusive choices

Date reported: 2026-09-23
Status: fixed on the PR branch; staging follows the verified deployed contract
Area: documentation
Related PR: https://github.com/ViceScale/airscale-docs/pull/37
Related tests: tests/work-email-inputs.test.mjs; tests/openapi.test.mjs

## User Report

The work-email reference shows Options 1, 2, and 3 even though users can send all known data points together. The user also described company-only and name-only input as sufficient; that conflicts with the deployed handler and remains a clarification before publication.

## Reproduction

Open `/api-reference/email-finder` on the hosted Mintlify preview. Under Body, the request renders three Option tabs. This was reproduced in Chromium on desktop and mobile without submitting an API request.

## Root Cause

Mintlify renders nested `anyOf` minimum-input requirements as variant tabs. The underlying schema already permits combinations, but the display suggests separate modes. The deployed Worker instead checks `hasLinkedin || (first_name && last_name && (domain || company_name))` and reads no `full_name` field. Its source SHA-256 is recorded in `contracts/deployed-public-api-evidence.json`. No provider requests were made.

## Fix

Represent the same minimum inputs using OpenAPI 3.1 `if`/`then` and retain one field list. Add prose and examples covering LinkedIn alone, split name with company name, split name with domain, and all five fields together. The shared bulk-email item schema retains the same validation logic. No runtime or accepted-input change is included.

## Regression Coverage

`tests/work-email-inputs.test.mjs` accepts the complete combinations and rejects missing inputs, company-only, name-only, and unsupported `full_name`. Existing contact schemas and generated-example checks cover the single and bulk routes.

## Verification

The new test failed on the old top-level `anyOf` schema, then passed after the change. Focused OpenAPI and generated-example checks passed. Desktop (1440 px) and mobile (390 px) browser checks passed after a fresh Mintlify startup: one request field list, all-fields example, no page errors or document overflow. `npm run validate` passed with all 343 tests and Mintlify validation. The separately generated final production candidate also passed `mint validate`. All 82 legacy URLs passed local candidate HTTP checks. No production deployment or domain switch was performed.

## Watch Later

Company-only or name-only support would require a separately specified backend change; do not advertise it based on a documentation-only edit. Validate the rendered Body after schema regeneration and a fresh Mintlify server startup.

## Authorized staging follow-up

On 2026-09-23 (Europe/Paris), a fresh read-only Worker download had the same SHA-256. The authorized staging release documents the existing accepted inputs and removes misleading mutually exclusive Option tabs. No backend behavior is expanded. Company-only/name-only support remains an unimplemented product requirement, not a supported request example.

Hosted verification completed: airscale.mintlify.app/api-reference/email-finder renders the five request fields together with the allKnownFields example and no request Option tabs on desktop/mobile. No document overflow or captured browser error. This verifies documentation presentation, not new API input support.
