# Hosted documentation staging plan

Execute inline without delegation. The user authorized steps 1, 2, and 3: resolve the work-email documentation discrepancy, stage the updated Mintlify documentation, and verify hosted permanent redirects. This supersedes the earlier prohibition on staged publication only. Do not change DNS/custom domains, merge PR #37, deploy an API Worker, purchase a plan, or send paid API requests.

- [x] Re-read the deployed work-email source without invoking providers. Document its supported inputs, including combined fields; do not invent company-only or name-only behavior.
- [x] Add a deterministic noindex staging mode to the publication generator, including the same route inventory and permanent redirects as production.
- [x] Add staging-specific assertions to the HTTP checker without relaxing production indexing or redirect requirements. Verify failing tests before implementation.
- [x] Validate the source and generated staging artifact.
- [ ] Push a separate generated staging branch and select it in Mintlify's Git settings. Preserve the old serving branch for rollback.
- [ ] Check all hosted routes, noindex, canonicals, sitemap, real 404, and exact permanent redirects. Verify hosted search and the work-email UI on desktop/mobile without API submissions.
- [ ] Record deployment evidence and remaining domain-cutover gates.

## Work-email disposition

The 2026-09-23 local-date read-only recheck returned the same deployed Worker SHA-256 already recorded in `contracts/deployed-public-api-evidence.json`. The staging docs describe this implemented contract: LinkedIn URL alone, or first_name + last_name with company_name/domain; all five fields may be sent together. A full name must be split into the supported name fields. Company-only, name-only, or a raw full_name field are not advertised as sufficient. This settles which behavior the migration candidate documents; it does not implement the broader behavior the user previously described or claim that requirement is delivered.
