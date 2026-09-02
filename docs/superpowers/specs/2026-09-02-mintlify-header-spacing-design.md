# Mintlify Header Spacing Hotfix

## Goal

Increase the colored padding around the Airscale mark without scaling the mark or wordmark, and set the `Open Dashboard` button corner radius to exactly 10px.

## Approved design

- Enlarge the logo tile from 28x28px to 38x38px.
- Keep the canonical Airscale mark at its current rendered dimensions and center it inside the larger tile.
- Keep the `Airscale` wordmark at its current rendered size and preserve its light/dark fills.
- Preserve a compact gap between the tile and wordmark.
- Set the desktop `Open Dashboard` anchor and Mintlify overlay to a 10px corner radius.
- Preserve the existing CTA colors, hover colors, link, label, focus treatment, and mobile More-menu behavior.

## Scope boundary

Change only the two Mintlify logo SVGs, the exact dashboard CTA CSS, and their regression tests. Do not change Framer, DNS, custom domains, canonicals, indexing, global colors, favicon behavior, API/reference content, or MCP behavior.

## Verification

- Tests must fail before implementation for the old 28x28 tile and missing 10px radius.
- The complete docs validation must pass.
- Browser QA must cover desktop and mobile in light and dark mode, including clipping, overflow, CTA hover/focus, and the mobile More menu.
- Release must use an exact reviewed SHA, a successful Mintlify deployment check, and hosted-page verification.
