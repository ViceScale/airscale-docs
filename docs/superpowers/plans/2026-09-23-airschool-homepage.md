# AirSchool homepage implementation plan

**Goal:** Recreate the user-approved Framer homepage in Mintlify, including the original artwork, hero, native search, corrected shortcuts, category cards, and support cards.

**Architecture:** Static semantic HTML in `index.mdx` with `mode: custom`; namespaced responsive and dark-mode styles in `airschool.css`. Store the four reference assets in `images/airschool/`. The hero search button delegates to the existing Mintlify desktop/mobile search entry points through `custom.js`; no second search service or paid API calls. Keep existing navigation, metadata, and noindex staging policy.

**Execution:** Independently in the existing isolated docs worktree. The user's “ok do it” approves the design described in the preceding reply. Domain migration remains outside scope.

- [x] Download and inspect reference assets; compare the original desktop layout and computed typography.
- [x] Rebuild `index.mdx`, style only `.airschool` descendants in `airschool.css`, and delegate the hero search click to Mintlify's existing search button.
- [x] Include `airschool.css` in `scripts/prepare-publication.mjs` and verify generated publications retain stylesheet and referenced assets byte-for-byte.
- [ ] Regenerate agent discovery files using `npm run agents:build`; run `npm run validate` and generate/validate staging and production artifacts.
- [ ] Run the homepage in Mintlify; verify desktop, mobile, dark mode, search click/keyboard/results, corrected shortcut, API card navigation, image loading, and browser errors. Record exact evidence.
- [ ] Commit/review the source change, publish only the authorized noindex staging artifact, verify hosted content/SEO, and refresh the prepared production artifact without selecting it or changing DNS.

Typography measured from the reference: Poppins; hero 48px/56px weight 600; section headings 20px/28px; card headings 16px/24px; card descriptions 12px/16px. Main content max-width 1200px with 32px gutters, 80px section spacing, three category columns, and two support columns. On narrow screens use one column, smaller hero text, wrapping shortcuts, and a touch-friendly search button. Keep original 36px category and 32px support corner radii. Use h3 for card headings rather than the reference's h5 to preserve heading order.

The original Sales Navigator shortcut incorrectly points to `/docs/hubspot-app`; the recreated shortcut points to `/docs/sales-navigator`. All other supplied destinations remain intact. Mintlify's header retains direct MCP and CLI navigation.
