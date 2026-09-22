# API documentation migration readiness implementation plan

> Execute in this isolated branch. User authorized all pre-migration documentation updates; production DNS and domain cutover are outside this change.

**Goal:** Preserve existing API documentation routes, restore useful contract explanations, explain previous documentation corrections, and generate a validated production publication candidate.

**Architecture:** Keep source documentation on the preview origin until cutover. Add a separate deterministic publication build that transforms content and generated discovery files to the production documentation origin without network mutations. Preserve legacy API pages with evidence-based support guidance rather than asserting retirement from an old inventory label.

**Base:** airscale-docs c85fd6fc3c5769aa2a50d962ed9566c0d9aea219.

- [x] Verify DNC and Leads Finder evidence using public documentation, current application source, and no-spend route inspection; record evidence and limitations.
- [x] Restore Find People same-role semantics and response field guidance in `api-reference/find-people.mdx`, `api-reference/find-people/count.mdx`, and search OpenAPI descriptions.
- [x] Restore Find Companies field/sanitization guidance and filter discovery examples in its two MDX pages.
- [x] Add `api-reference/documentation-corrections.mdx`, preserve `api-reference/leads-finder.mdx` and `api-reference/dnc-checker.mdx`, and update navigation plus the legacy route inventory.
- [x] Add deterministic `scripts/prepare-publication.mjs` and route coverage verification. Test preview preservation, production canonicals/robots/discovery links, retained legacy pages, and redirects for consolidated API-reference pages.
- [x] Regenerate OpenAPI and agent discovery files. Run `npm run validate`, route inventory checks, and production-candidate validation; inspect rendered pages and verify links without executing paid API calls.
- [x] Review the complete diff and record exact validation and cutover instructions.

**Delivery:** Commit this branch and open a reviewable PR. Merge and the production domain switch are separate release steps.
