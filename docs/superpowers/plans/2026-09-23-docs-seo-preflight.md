# Documentation SEO preflight implementation plan

> Execute inline; the user explicitly requested independent work without delegation.

**Goal:** Finish pre-migration SEO preparation while keeping docs.airscale.io on its current host.

**Architecture:** Preserve the existing preview boundary and generate a separate production artifact. Add an explicit homepage, permanent redirects, canonical metadata and a sitemap derived from the published page set. A read-only HTTP checker verifies the candidate and later the production domain with the same expectations.

**Tech stack:** Mintlify 4.2.850, MDX, Node.js tests, JSON Schema, Google Search Console.

## Approved scope

The user approved the pre-switch steps described in the conversation: redirects, indexing, sitemap, homepage, duplicate-host handling, Search Console baseline, hosted candidate checks and rollback preparation. Do not change DNS, buy a plan, publish the production artifact, merge PR #37, or change the unresolved work-email contract.

## Tasks

- [x] Record Search Console performance for docs.airscale.io with an exact window, URL Inspection results, existing sitemap status, and current host/DNS settings. Keep private telemetry outside this public repository.
- [x] Reproduce the root redirect and temporary redirects. Inspect deployed-settings access and hosted-preview entitlement without changing either.
- [x] Add failing publication tests: index.mdx is included; root canonical ends in `/`; all inventory URLs have a destination; moved-page redirects are explicitly permanent; generated sitemap has only production canonical pages; production robots is crawlable.
- [x] Add a balanced documentation homepage with product and API entry points, plus MCP and CLI links. Include it in navigation and generated agent files without altering existing guide content.
- [x] Make publication redirects explicitly permanent and add global production canonical metadata. Generate a production sitemap/robots file and a full route manifest. Preserve the source preview noindex boundary.
- [x] Add a read-only SEO verifier that checks status, redirect destination and permanence, robots/header indexing, page canonical, sitemap coverage, and a real missing URL. Test rejection of temporary redirects and noindex headers using local fixtures.
- [x] Generate the candidate, run tests and Mintlify validation, then run the HTTP verifier and browser checks.
- [ ] Verify the hosted candidate: blocked by the current plan lacking PR previews; no paid upgrade.
- [x] Update the migration runbook with exact cutover checks, preview-host canonical behavior, rollback instructions, validation receipts, and remaining gates. Commit and push to PR #37.

## Execution limits

Local implementation and validation completed. Hosted candidate verification remains blocked by the current plan lacking PR previews; no plan upgrade or live-domain change was performed. Private baseline and rollback evidence are outside this public repository. The final PR push is recorded in the handoff.
