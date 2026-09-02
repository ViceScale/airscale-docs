# Mintlify Header Spacing Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double the colored padding around the unchanged rendered Airscale mark and give the `Open Dashboard` CTA exactly 10px corners.

**Architecture:** Keep the canonical SVG path and preserve its current physical scale while expanding the tile to 38x38px. Override Mintlify's `h-7` logo class only inside `#navbar`, and extend the existing fail-closed CTA CSS contract with exact radius declarations.

**Tech Stack:** SVG, CSS, Node.js test runner, Mintlify CLI, browser QA.

---

## File map

- `tests/site.test.mjs` — exact SVG geometry and scoped CSS contract.
- `logo/light.svg` and `logo/dark.svg` — larger tile with unchanged rendered mark and wordmark.
- `custom.css` — navbar logo height and CTA radius overrides.

### Task 1: Add failing geometry and radius tests

**Files:**
- Modify: `tests/site.test.mjs`

- [ ] Update the exact SVG assertions to require `viewBox="0 0 157 38"`, a `38x38` tile at `x=0 y=0` with `rx=8`, canonical path transform `translate(9.2 12) scale(.28)`, and wordmark geometry `x=48.5 y=25.125 font-size=17.5`.
- [ ] Add `#navbar img.nav-logo:is([alt="light logo"], [alt="dark logo"])` to the approved selector set and require exactly `height: 38px !important`.
- [ ] Require `border-radius: 10px !important` on the exact dashboard anchor and its direct Mintlify overlay.
- [ ] Add mutations proving `9px`, missing `!important`, and a broad `.nav-logo` selector are rejected.
- [ ] Run `node --test tests/site.test.mjs`; expect failures caused by the old 28px tile, absent logo-height rule, and absent 10px radius.
- [ ] Commit only `tests/site.test.mjs` as `test: lock Mintlify header spacing`.

### Task 2: Implement the minimal hotfix

**Files:**
- Modify: `logo/light.svg`
- Modify: `logo/dark.svg`
- Modify: `custom.css`

- [ ] In both SVGs use a `157x38` viewBox and `<rect x="0" y="0" width="38" height="38" rx="8" fill="#111827"/>`.
- [ ] Keep the canonical `d` value unchanged and use `transform="translate(9.2 12) scale(.28)" fill="#FFFFFF"` so the rendered mark remains its current size and gains at least twice the prior minimum padding.
- [ ] Move the unchanged rendered wordmark to `x="48.5" y="25.125"` with `font-size="17.5"`; retain the existing font family, weight, and mode-specific fill.
- [ ] Add the exact navbar-logo selector with `height: 38px !important`.
- [ ] Add `border-radius: 10px !important` to the dashboard anchor and direct overlay; do not change colors, dimensions, focus, or behavior.
- [ ] Run `node --test tests/site.test.mjs`; expect all focused tests to pass.
- [ ] Run `git diff --check` and `npm run validate`; expect no whitespace errors, all tests passing, valid OpenAPI, and Mintlify build validation success.
- [ ] Commit the runtime files as `fix: adjust Mintlify header spacing`.

### Task 3: Browser QA and guarded release

**Files:**
- Verify: `logo/light.svg`
- Verify: `logo/dark.svg`
- Verify: `custom.css`

- [ ] Start the local Mintlify preview and test 1440x900 desktop plus 390x844 mobile in light and dark modes.
- [ ] Measure a 38px-tall logo lockup, unchanged mark and wordmark sizing, unclipped tile, and no horizontal overflow.
- [ ] Measure exactly 10px CTA corners on the anchor and overlay; verify existing normal, hover, focus, link, label, and mobile More-menu behavior.
- [ ] Confirm no console errors and stop the local preview.
- [ ] Push the exact reviewed SHA, create a scoped PR, wait for terminal checks, and merge only if the PR head still matches.
- [ ] Wait for the merge commit's `Mintlify Deployment` check to succeed.
- [ ] Repeat the hosted desktop/mobile light/dark measurements at `https://airscale.mintlify.app/api-reference/api-overview` before claiming live.
