# Bug: Miscellaneous API documentation uses miscale-news slugs

Date reported: 2026-09-30
Status: fixed locally
Area: documentation URLs
Related tests: tests/preview-safety.test.mjs, tests/publication-migration.test.mjs, tests/site.test.mjs, tests/contracts.test.mjs, tests/mcp-pages.test.mjs, tests/api-reference-presentation.test.mjs

## User Report

The Meta Ads documentation URL contains `miscale-news`; the section should use `miscellaneous`.

## Reproduction

Opened https://docs.airscale.io/api-reference/miscale-news/meta-ads in Chrome. The page and its sidebar used the typo for Meta Ads, Email verifier, WhatsApp checker, and WhatsApp check status. The section heading already displayed Miscellaneous.

## Root Cause

The four MDX pages were stored under `api-reference/miscale-news`, and navigation, canonical metadata, contracts, and generated discovery files repeated those paths.

## Fix

Move all four pages to `api-reference/miscellaneous`. Update navigation, internal links, API/MCP documentation contracts, generated discovery files, and their existing test expectations. Preserve the old URLs through four exact permanent redirects. The production generator includes the new canonical paths and sitemap entries.

## Regression Coverage

Updated existing route and contract assertions. The preview configuration test now checks the exact four permanent redirect mappings. The publication test expects seven redirects, including the three existing MCP redirects.

Manual hosted smoke path: request each old URL without following redirects; require HTTP 308 and the corresponding new URL. Open the new Meta Ads page in Chrome and confirm the four sidebar links use `miscellaneous`.

## Verification

- Browser reproduction confirmed the reported typo.
- `npm run publication:check`: passed; all 21 legacy API routes preserved.
- `npm run mint:validate`: passed for the source.
- `npm run validate`: passed, including the full test suite, generated-file checks, and source Mintlify build.
- Production artifact `mint validate`: passed.
- Focused route, contract, and publication tests: 88 passed, 0 failed.

## Watch Later

Hosted redirects must be verified after publication; source configuration alone does not prove live redirect behavior.
