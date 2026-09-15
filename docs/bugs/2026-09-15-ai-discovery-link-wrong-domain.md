# Bug: Markdown AI discovery linked to a missing index on the legacy domain

Date reported: 2026-09-15
Status: fixed (live)
Area: documentation hosting / AI discovery
Related tests: `npm run check:live-ai-discovery`

## User Report

The AI discovery link is broken and must be fixed as a priority. The existing Miscellaneous API category is outside this fix.

## Reproduction

Fetch `https://airscale.mintlify.app/api-reference/email-finder.md` anonymously. Mintlify's generated header directs agents to `https://docs.airscale.io/llms.txt`, which returns HTTP 404. The same error occurs in API, CLI, MCP, product-guide, content-negotiated Markdown and Markdown 404-recovery responses. The existing Mintlify index itself returns HTTP 200.

## Root Cause

Mintlify's dashboard registered `docs.airscale.io` as the deployment's custom domain before that domain was migrated from Framer. The hosted Markdown renderer uses that domain for its automatic index header. Repository files correctly use `airscale.mintlify.app`, so local generated-artifact checks and all 329 documentation tests passed without detecting the dashboard drift.

## Fix

Removed the unused `docs.airscale.io` custom-domain registration from the Airscale Mintlify deployment and triggered a manual update of the existing main revision. DNS records and the Framer site were not modified. Mintlify's default `.site` address and the existing `.app` address both host the documentation index.

The fix lives in Mintlify's deployment configuration, not a page-copy override. `scripts/check-live-ai-discovery.mjs` provides an opt-in anonymous-GET regression check for the actual hosted behavior. It accepts the working Mintlify `.app` and `.site` origins, follows the emitted index, checks that it returns real Airscale content, and verifies root and `.well-known` discovery assets. Run it after future documentation deployments or domain-setting changes.

## Verification

- Before correction: 1/8 live smoke cases passed; all seven Markdown discovery-link cases failed with the legacy domain.
- Dashboard after correction offers **Add domain**, confirming no custom domain remains registered.
- `docs.airscale.io/` still returned HTTP 200 with the same Framer ETag after the dashboard change.
- Post-rebuild `npm run check:live-ai-discovery`: 8/8 passed on ordinary public URLs. The emitted index is now `https://airscale.mintlify.site/llms.txt` and resolves to the Airscale index with working `.app` page links.
- Independently checked all three Miscellaneous API Markdown pages: each emits the corrected index URL.
- Mintlify Activity recorded the manual rebuild as Successful.
- `npm run validate`: 329/329 tests passed, generated OpenAPI/MCP/agent artifacts matched, and Mintlify build validation passed.
- Independent review found no important issues; mocked healthy discovery passed 8/8 with exit 0 and legacy-domain discovery failed seven cases with exit 1.

## Watch Later

Register the custom domain again only when a coordinated domain migration makes its discovery assets available. Re-run the live smoke after switching hosts and update the allowed-origin contract at that time. A passing local build alone cannot prove Mintlify's generated hosted links are correct. Check uncached and ordinary URLs if deployment propagation is incomplete.
