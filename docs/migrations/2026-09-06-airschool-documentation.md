# AirSchool Documentation migration

Source: [AirSchool Documentation](https://docs.airscale.io/docs/sales-navigator), captured 2026-09-06.
Destination: the existing [Airscale Mintlify preview](https://airscale.mintlify.app).

The Documentation tab contains all 48 pages from the live sidebar, retaining its
five groups and route order: Build lists (10), Enrichments (26), Export (6), CRM
integrations (2), and Utilities (4). Existing API Reference and MCP & Agents
content and navigation are preserved. The source's `/docs/filer-tables` spelling
is deliberately retained for URL continuity.

The migration preserves the source titles, descriptions, prose, headings, lists,
emphasis, code example, four tables, and link targets. Screenshots are hosted
locally: 267 image occurrences use 258 unique original image files. One original
MP4 walkthrough is also stored locally. The three YouTube embeds retain their
original videos and use reader-initiated playback. The MP4 retains muted looping
behavior and exposes native playback controls.

Representational changes are limited to native Mintlify Markdown/MDX, local
asset URLs, descriptive image alternative text where the source had none,
YouTube autoplay being disabled, removal of Framer breakpoint duplicates and
framework comments, and syntax/whitespace normalization. Content is migrated as
written; its product claims have not been independently updated or audited.
Mintlify provides the page header, sidebar, table of contents, and pagination.

`inventory/airschool-documentation.json` records source HTML hashes, whitespace-
normalized text hashes, original headings/tables/code/link targets, image
placement order, and downloaded asset sizes/checksums. Captured HTML and the
one-time conversion script remain in the migration worktree's ignored `.local/`
directory. The capture is an audit snapshot, not a live synchronization feed.

Verification completed before publication:

- `npm run validate`: 303 tests passed, zero failures/skips; OpenAPI, MCP, and
  generated agent files are current; Mintlify build validation passed.
- Fifty new checks cover the 48 source page comparisons, exact navigation,
  local media existence/checksums, resolved links, and preview canonicals.
- All 48 local rendered URLs returned HTTP 200 with the expected title,
  non-empty content, image count, and table count.
- Browser QA checked Sales Navigator prose/screenshots/table, YouTube rendering,
  MP4 metadata and decode readiness, mobile navigation, and a 390 × 844 HubSpot
  guide with all 12 screenshots loaded and no horizontal page overflow.
- Dark theme switches successfully and the page retains its width.
- An independent review compared mixed heading/media order, list semantics,
  emphasis, and original links against the captured HTML; no blocking findings.
- `git diff --check` passed.

Local Mintlify search requires CLI login; search must be checked on the hosted
deployment. Hosted deployment/route verification belongs to the associated pull
request handoff. The existing preview-only robots/canonical policy remains in
force. No DNS records, live Framer content, application deployment, or provider
work were changed by this migration.
