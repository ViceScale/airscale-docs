# API documentation migration

## Scope and evidence

This change prepares the Mintlify documentation for replacing the Framer documentation at `https://docs.airscale.io`. It does not change DNS, bind a custom domain, deploy a Worker, or execute enrichment requests.

The branch is based on documentation commit `c85fd6fc3c5769aa2a50d962ed9566c0d9aea219`. On 2026-09-22, read-only Cloudflare inspection confirmed these production routes and downloaded their deployed script source:

- `api.airscale.io/v1/dnc-check` → `dnc-checker`.
- `api.airscale.io/v1/leads-finder` → `leads-finder`.
- `api.airscale.io/v1/leads-finder/preview` → `leads-finder`.

`contracts/deployed-public-api-evidence.json` records source SHA-256 hashes and the observed contracts. Source downloads remain outside this repository because deployed bundles can contain operational details. This proves route registration and deployed implementation, not an end-to-end paid-provider health check. No evidence supported the old inventory's Leads Finder retirement claim. Both previously omitted documentation paths are restored, and all three operations are represented in OpenAPI.

DNC's deployed limit is 5 requests per second, correcting the old page's 3 requests per second. Its US-only input, one-credit successful-check price, and response shape were inspected in the deployed handler. Leads Finder's preview route uses the same paid handler as its primary route; it must not be described as a free count operation.

## Preview validation

```bash
npm ci
npm run validate
npm run inventory:check
npm run publication:check
```

`publication:check` validates a deterministic production candidate in memory. It checks all 21 legacy `/api-reference/` sitemap routes, including three exact MCP-guide redirects. It does not write files or contact the live site. The normal source configuration stays `noindex, follow` with preview-domain canonicals.

## Verification recorded on 2026-09-22

- `npm run validate`: passed, including generated-file checks, all 342 tests, and the Mintlify build validator.
- `npm run inventory:check`: passed against the live 82-route Framer sitemap.
- `npm run publication:check`: passed; 384 publication files and all 21 legacy API routes accounted for.
- Generated production candidate: passed its own `mint validate` run.
- Local production HTTP checks: all 21 legacy API paths passed, including the three redirects. Every retained page returned HTTP 200, its production canonical, and `index, follow` robots metadata.
- Browser checks: DNC, Leads Finder, its preview alias, documentation corrections, Find People, people count, Find Companies, and company filter values passed at 1440 px and 390 px (16 page/viewport combinations). Checks covered successful navigation, expected headings/content, no page errors, and no document overflow. DNC desktop and Leads Finder mobile screenshots were visually inspected.
- Independent read-only review of the restored endpoint contracts and publication generator found no actionable material defects.

Browser checks used the local preview with requests to the API and MCP hosts blocked. Search activation requires Mintlify login and was not tested locally. Hosted deployment, production search, cache propagation, and custom-domain behavior must be verified during cutover; these local checks do not claim the site is already published.

## Prepare the production publication

Choose a new absolute directory outside the source checkout:

```bash
npm run publication:prepare -- --out /tmp/airscale-docs-production-candidate
```

The command refuses to overwrite an existing directory. The output contains publishable pages/assets, `docs.json`, the complete OpenAPI specification, generated discovery files, and a SHA-256 publication manifest. It excludes repository metadata, scripts, internal notes, and implementation plans.

The candidate changes robots to `index, follow`, rewrites documentation canonicals and discovery links to `https://docs.airscale.io`, removes preview-only discovery boilerplate, and adds redirects for:

| Old API documentation path | Replacement |
| --- | --- |
| `/api-reference/connect-airscale-mcp-to-chatgpt` | `/mcp/connect-airscale-mcp-to-chatgpt` |
| `/api-reference/connect-airscale-mcp-to-claude` | `/mcp/connect-airscale-mcp-to-claude` |
| `/api-reference/airscale-mcp-server` | `/mcp/airscale-mcp-server` |

The API host stays `https://api.airscale.io`, and the operational MCP host stays `https://mcp.airscale.io/mcp`. Bulk-email and other unchanged endpoint paths are preserved exactly, including parentheses in the bulk-email documentation slug.

Validate the output with the pinned Mintlify CLI from the source checkout:

```bash
cd /tmp/airscale-docs-production-candidate
/absolute/path/to/airscale-docs/node_modules/.bin/mint validate
```

Use the validated output as the content of the production publication branch, retaining repository tooling separately if needed. Configure Mintlify's production deployment to serve this content when the custom domain is switched. Subsequent documentation changes must regenerate the candidate from the updated source; do not edit generated output by hand. Do not deploy the indexable production candidate to the preview hostname while it is the only public host.

## Cutover and verification

The production host switch is a separate release step. Before it, preserve the current DNS/deployment configuration for rollback. Publish the validated candidate and configure the Mintlify custom domain, then verify:

1. Each entry in `publication-manifest.json` → `apiRoutes` returns the expected page or exact redirect on `docs.airscale.io`.
2. DNC Checker, Leads Finder, its preview alias, Find People, Find Companies, and documentation corrections render on desktop and mobile.
3. Page canonicals use `https://docs.airscale.io`, and production pages permit indexing.
4. `/openapi.json`, `/llms.txt`, `/llms-full.txt`, and `/skill.md` contain production documentation URLs and no preview-host references. Check both ordinary and cache-busted discovery URLs before attributing differences to a failed deployment.
5. Search/navigation and the count/filter-value links work. Inspect console errors and narrow-screen overflow.
6. Verification does not submit paid API playground requests.

If the host switch fails, restore the preserved DNS/deployment configuration. The documentation changes do not require any API runtime rollback.
