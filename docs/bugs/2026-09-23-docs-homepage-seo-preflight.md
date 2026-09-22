# Bug: Migration root opens an unrelated guide and SEO checks accept temporary redirects

Date reported: 2026-09-23
Status: homepage and publication metadata fixed on PR branch; hosted redirects remain a release gate
Area: documentation publication
Related PR: https://github.com/ViceScale/airscale-docs/pull/37

## Reproduction and root cause

The previous generated candidate had no index.mdx, so Mintlify redirected `/` to `/docs/sales-navigator` with HTTP 307. The old route probe treated any 3xx with the expected Location as a pass. That verified navigation but did not require permanent redirects for moved pages. A production sitemap and explicit global canonical were not generated.

## Fix

Add a balanced root homepage and include it in navigation, publication, and agent discovery files. Generate production sitemap/robots files and a full legacy-route manifest. Set explicit permanent redirect flags and production canonical defaults. Add a reusable strict read-only SEO checker, which rejects temporary redirects, indexing exclusions, canonical errors, bad sitemap coverage and soft 404s.

## Regression coverage and evidence

Publication tests failed before the implementation and pass afterward. SEO checker tests cover noindex headers, page exclusions, wrong canonicals, temporary/wrong redirects, Googlebot rules, and malformed sitemap XML. All 348 tests and source/candidate Mintlify validators passed. Local HTTP audit: 100 canonical pages plus robots/sitemap/404 passed; the three redirects still return 307 despite permanent flags and are correctly reported as failures. Homepage desktop/mobile rendering and the API entry link were checked in Chrome; no mobile overflow or captured browser errors.

## Watch later

Do not infer hosted 308 behavior from local configuration. Verify on Mintlify hosting before cutover, then on docs.airscale.io immediately after the authorized switch. The current plan does not include PR preview deployments. See ../SEO_MIGRATION_PREFLIGHT.md for exact commands, rollout gates, and rollback steps. No DNS, production deployment, paid API, or plan mutation was performed.
