# AirSchool Use cases migration

Source: [AirSchool Use cases](https://docs.airscale.io/usecases/quick-beginner-guide), captured 2026-09-06.
Destination: the existing [Airscale Mintlify site](https://airscale.mintlify.app).

The new Use cases tab retains all eight source routes and their original order:
Getting started (1), Using AI (3), and GTM use cases (4). Existing Documentation,
API Reference, and MCP & Agents pages remain intact.

Titles, descriptions, prose, headings, lists, emphasis, and link targets are
preserved. Internal links resolve to their existing Mintlify routes. Five
original GIFs and five original MP4 demonstrations are stored locally; their
combined size is 43,129,252 bytes. Six YouTube embeds retain their source video
URLs and reader-initiated playback. Native MP4s retain muted looping playback
and expose playback controls.

All 21 prompts on Templates retain their complete text, field placeholders,
and explicit line breaks. Native Mintlify `text wrap expandable` code blocks
provide copying, wrapping, expansion, and collapse. Trailing spaces at the ends
of lines are normalized. Source field badges become literal placeholder text.
Native YouTube players display their own thumbnails instead of duplicating the
Framer poster overlay. Other adaptations are Markdown/MDX syntax, local media
paths, image alternative text, removal of duplicate responsive variants, and
Mintlify navigation, page headers, and table of contents. Historical product
claims and dated example instructions are retained as written.

`inventory/airschool-usecases.json` records source HTML hashes, normalized text
hashes, headings, full prompt values, links, ordered media, and binary asset
checksums. Raw HTML and the conversion script remain in the worktree's ignored
`.local/` directory. This is a captured migration, not continuous synchronization.

Verification evidence:

- Eleven focused checks pass for complete navigation, all eight source text and
  structure comparisons, all ten asset checksums, and all 21 prompt controls.
- All eight local rendered routes return HTTP 200 with the expected title,
  non-empty content, media counts, complete sidebar, and preview robots metadata.
- Browser QA confirms 21 copy buttons and 21 expansion controls. The first
  prompt copies its complete 1,557 characters and expands and collapses.
- At 390 × 844, Templates and The basics of AI have no horizontal page overflow.
  All five GIFs load; all five MP4s decode at 3840 × 2160 with readyState 4,
  native controls, muted loops, and no media errors.

Full validation, independent review, and hosted deployment evidence are recorded
in the associated pull request. Local search requires Mintlify CLI login; search
is verified after publication. Preview canonical/robots policy is retained.
No DNS records or source Framer content are changed by this migration.
