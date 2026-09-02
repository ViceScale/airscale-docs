# Bug: Mintlify logo mark was off-center inside its tile

Date reported: 2026-09-02
Status: fixed locally
Area: UI
Related issue:
Related PR: N/A (not committed)
Related tests: `tests/site.test.mjs` light/dark tiled Airscale lockup tests

## User Report

The enlarged Mintlify header logo looked visibly misaligned after deployment.

## Reproduction

Open `https://airscale.mintlify.app/api-reference/api-overview` and inspect either theme. Rasterizing the deployed 157x38 SVG places the white mark at center `(17, 19.5)` while the 38x38 tile center is `(19, 19)`.

## Root Cause

The tile-growth change preserved the mark's physical scale but chose `translate(9.2 12) scale(.28)` from nominal path dimensions. The asymmetric canonical path renders two pixels left of the tile's optical center.

## Fix

Changed only the canonical mark transform in `logo/light.svg` and `logo/dark.svg` from `translate(9.2 12) scale(.28)` to `translate(11.2 11.5) scale(.28)`. The tile, wordmark, CTA, and header dimensions remain unchanged.

## Regression Coverage

`tests/site.test.mjs` now requires the optically centered transform in both logo assets. The test failed against the deployed transform before the SVG edit and passes after it.

## Verification

- `node --test tests/site.test.mjs`: 18/18 passed.
- Sharp raster probe at 157x38: both marks have bounds `[12, 12, 26, 26]`, center `(19, 19)`, exactly matching the tile center `(19, 19)`.
- `npm run validate`: 253/253 tests passed; OpenAPI valid; Mintlify build validation passed.
- Local browser QA at 1440x900 and 390x844 in light and dark mode: logo remained 157x38, centered vertically at `y=12.5` in the 64px header, no horizontal overflow, and no console errors.
- Hosted verification is pending deployment.

## Watch Later

SVG path geometry is asymmetric, so nominal coordinate centering is insufficient. Future tile changes must compare rendered mark bounds with the tile center.
