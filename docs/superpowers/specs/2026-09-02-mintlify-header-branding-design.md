# Mintlify header branding design

## Goal

Update only the Mintlify preview header so it uses the approved Airscale treatment:

- A white Airscale mark inside a compact rounded black tile.
- The word `Airscale` beside the tile.
- An `Open Dashboard` primary navigation button.
- A black button with white text in light mode.
- A white button with black text in dark mode.

The result must remain legible and unclipped on desktop and mobile widths.

## Scope boundary

This change applies only to the Mintlify repository and preview at `airscale.mintlify.app`.

It must not change:

- The retained Framer documentation site.
- DNS or custom-domain configuration.
- Canonical URLs or indexing policy.
- The dashboard destination URL.
- Airscale's global primary blue or unrelated Mintlify controls.
- Documentation content, API contracts, or MCP behavior.

## Logo assets

Keep the existing `docs.json` light/dark logo paths and replace the two SVG assets in place.

### Light mode

`logo/light.svg` renders the real Airscale mark in white within a black rounded square, followed by `Airscale` in near-black. The SVG must remain self-contained, accessible, and free of scripts, external resources, and embedded raster images.

### Dark mode

`logo/dark.svg` uses the same white mark and black rounded square, followed by `Airscale` in white. The tile remains black in both modes so the brand composition is stable.

Both assets use the existing Airscale path data rather than a newly invented mark. Their view boxes and internal spacing must prevent clipping at Mintlify's rendered navbar height.

## Navbar CTA

Change the configured label from `Open dashboard` to `Open Dashboard`. Keep `https://app.airscale.io/dashboard` and the button type unchanged.

Mintlify does not expose a per-navbar-button color field in `docs.json`, so add a root `custom.css` file. Scope its rules to the navbar and the exact dashboard link. Do not alter the global `colors.primary` values.

The CSS contract is:

- Light mode: black background, white label and icon.
- Dark mode: white background, black label and icon.
- Preserve visible keyboard focus and the platform's existing size, radius, and spacing.
- Apply a restrained hover treatment without changing layout.

Implementation must confirm Mintlify's rendered theme attribute and navbar DOM before choosing the final selectors. The selector must include the exact dashboard destination so unrelated links and buttons cannot inherit the override.

## Responsive behavior

The logo and CTA must fit without horizontal clipping at Mintlify's desktop and mobile navigation breakpoints. The wordmark must remain readable wherever Mintlify displays the full logo. Existing responsive navbar behavior remains owned by Mintlify; the custom CSS must not introduce fixed widths, positioning, or layout overrides.

## Verification

Add regression assertions for:

- The exact `Open Dashboard` label and unchanged URL.
- The light and dark SVG structure, actual Airscale path, tile colors, wordmark colors, accessibility label, and absence of unsafe SVG content.
- The narrowly scoped light/dark CTA rules in `custom.css`.
- The unchanged global Airscale colors, Framer boundary, canonical policy, and indexing policy.

Run the full repository validation and Mintlify build validation. Then inspect the rendered preview in light and dark modes at desktop and mobile widths, checking logo fidelity, CTA colors, hover/focus visibility, and clipping.

## Release

Publish through a reviewed branch and pull request. Merge only after terminal validation succeeds, then wait for Mintlify's deployment check and verify the hosted preview. Do not perform any Framer or DNS action as part of this release.
