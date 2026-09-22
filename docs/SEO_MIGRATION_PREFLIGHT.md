# SEO migration preflight

Prepared on 2026-09-23 for PR #37. This is pre-migration preparation, not a production release receipt. Keep `docs.airscale.io` on Framer until the release gates below are satisfied.

## Prepared behavior

- Keep the domain and existing documentation paths. The publication manifest now covers all 82 legacy sitemap URLs, including `/`, rather than only the 21 API paths.
- Serve `index.mdx` at `/` with a documentation homepage and product/API/MCP/CLI entry points. It replaces the unintended redirect to the Sales Navigator guide.
- Publish global and per-page canonicals on `https://docs.airscale.io`. The root canonical is `https://docs.airscale.io/`, not `/index`.
- Generate `sitemap.xml` from navigable pages and retained legacy destinations: 100 unique canonical page URLs. Redirect sources are excluded.
- Generate crawlable `robots.txt` with the production sitemap address. The source checkout remains a noindex preview; production files are generated separately.
- Explicitly set `permanent: true` for the three API-to-MCP redirects.
- `scripts/check-seo.mjs` performs bounded read-only GETs. It requires 200/indexable pages with one correct canonical, a matching sitemap, crawl permission for Googlebot, exact 301/308 redirects, and a real 404 for a nonexistent page. It exits nonzero on a failed check.

## Checks performed

- `npm run validate`: all 348 tests passed, generated-file checks passed, and Mintlify build validation passed.
- `npm run inventory:check`: all 82 live Framer sitemap routes matched the inventory.
- `npm run publication:check`: 387 publication files, 21 legacy API routes, and the full 82-route manifest validated.
- The generated production candidate passed its own `mint validate`.
- Local HTTP audit: **103 of 106 checks passed**. All 100 canonical page checks passed, as did robots.txt, sitemap.xml, and missing-page 404. All three redirect destinations were correct, but their HTTP status was 307, so the strict audit correctly failed those checks.
- The homepage returned 200 and was visually inspected on desktop and at 390 px. Mobile content did not overflow. The API card opened API Overview; the inspected browser error log was empty.

Do not describe the local HTTP audit as a complete SEO pass. Even with `permanent: true`, the pinned local Mintlify runtime returns 307 for these redirects. Mintlify's current documentation specifies permanent 308 redirects; the actual hosted result must be checked before treating the redirect gate as complete.

## Baseline and rollback

Read-only checks captured documentation-only Search Console performance with an exact reporting window, sitemap-filtered indexing counts and exclusions, URL Inspection for the email-finder page, and submitted sitemap status. The report is not mixed with main-website statistics. Private traffic data and authenticated-dashboard observations are stored outside this public repository.

Both authoritative name servers currently report `docs.airscale.io CNAME sites.framer.app` with TTL 300. Keep the Framer site and custom-domain binding intact throughout the migration and monitoring period. Immediately before switching, save the current DNS provider record including proxy mode, Mintlify settings, and the exact source/publication commit and manifest hashes. Do not rely on an older snapshot if anything has changed.

If the new site has indexing blocks, widespread failures, or incorrect redirects after an authorized switch, restore the saved DNS record and confirm Framer serves the expected URLs. Reverting a Git commit alone does not undo a DNS migration. No API Worker rollback is involved.

## Duplicate-host strategy

Until cutover, `airscale.mintlify.app` stays `noindex, follow` with preview canonicals. The production artifact uses `docs.airscale.io` consistently for page canonicals and sitemap URLs. Once that artifact serves the custom domain, check BOTH hostnames: the official domain must be indexable, and any accessible default-host copy must canonicalize each page to the official equivalent (or permanently redirect there if the hosting configuration supports it).

Do not enable a project-wide noindex switch to hide only the Mintlify hostname: it would also block the production custom domain. A canonical is a search-engine signal, not a guarantee; monitor Google's selected canonical for representative pages after launch. No host-specific redirect has been claimed configured before custom-domain setup.

## Remaining release gates

1. Resolve the work-email documentation contract question already recorded in the API migration runbook. This preparation does not expand backend inputs or settle that question.
2. Obtain a hosted candidate and verify 301/308 status for the three moved paths, correct destinations, and working hosted search. The current dashboard marks PR preview deployments as available on Pro; the branch deployment check is skipped. No paid upgrade or alternate hosting service was created. A no-upgrade path is a separately authorized staged publication on the existing Mintlify hostname after the work-email decision, retaining noindex until cutover; test redirects and search there before changing DNS. Local validation does not substitute for this hosted check.
3. Recheck Mintlify's project-wide indexing setting, custom domain, and production serving branch at release time. Repository metadata alone cannot prove dashboard state. The Admin SDK settings call returned `No target deployment for this request`; authenticated dashboard inspection was used instead.
4. Only after an authorized release, serve the production artifact and bind/switch the custom domain. Run the exact-domain checks below immediately, then inspect representative URLs in Search Console and submit/refresh the production sitemap.

## Reproducible commands

Create a new candidate directory; the generator refuses to overwrite an existing one:

```sh
npm run publication:prepare -- --out /tmp/airscale-docs-seo-release
cd /tmp/airscale-docs-seo-release
/absolute/path/to/airscale-docs/node_modules/.bin/mint validate
```

From the source repository, check that candidate's local server or its approved hosted deployment:

```sh
npm run seo:check -- --base http://localhost:3210 --manifest /tmp/airscale-docs-seo-release/publication-manifest.json
```

After the custom-domain switch, rerun against the actual production host:

```sh
npm run seo:check -- --base https://docs.airscale.io --manifest /tmp/airscale-docs-seo-release/publication-manifest.json
```

Retain the JSON report and exit status. Do not loosen permanent-redirect or indexing assertions to make a deployment pass. Verify search and both hostname variants in the browser. Compare Search Console URL Inspection, indexing exclusions, clicks, and impressions with the captured baseline at one, two, and four weeks; allow for reporting lag and compare equivalent windows. Existing unindexed pages are not automatically migration regressions, and sitemap submission does not prove indexing.

## References

- [Mintlify SEO and indexing controls](https://www.mintlify.com/docs/optimize/seo)
- [Mintlify redirect behavior](https://www.mintlify.com/docs/create/redirects)
- [Google hosting-change guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-no-url-changes)
- [Google permanent and temporary redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects)

## Authorized hosted staging follow-up

The user subsequently authorized staging and hosted verification, without a domain switch. Generate a reproducible artifact with `npm run publication:prepare -- --staging --out /absolute/new/directory`. Its manifest declares `indexing: noindex`; the HTTP checker then requires a general noindex directive on every page while keeping the same canonical, sitemap, route, 404, and permanent-redirect checks. Production mode continues to require indexable pages. Serve the staging artifact from a separate generated branch, preserving the previous Mintlify serving branch (`main`) as the staging rollback target. PR #37 remains independent of the serving branch.

The work-email candidate uses the freshly verified deployed contract. This documentation release does not add company-only/name-only lookup or a raw full_name API field. See the [staging execution plan](superpowers/plans/2026-09-23-docs-hosted-staging.md).
