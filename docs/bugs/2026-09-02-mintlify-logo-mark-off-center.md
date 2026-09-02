# Bug: Mintlify logo mark was off-center inside its tile

Date reported: 2026-09-02
Status: open
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

Pending. Recenter only the canonical mark transform while preserving the tile, wordmark, CTA, and header dimensions.

## Regression Coverage

Pending exact-transform assertions plus desktop/mobile light/dark browser verification.

## Verification

Pending.

## Watch Later

SVG path geometry is asymmetric, so nominal coordinate centering is insufficient. Future tile changes must compare rendered mark bounds with the tile center.

