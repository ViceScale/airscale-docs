# Mintlify Header Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Mintlify preview an Airscale logo with a white mark on a black tile and a mode-aware black/white `Open Dashboard` navbar CTA.

**Architecture:** Keep the existing Mintlify logo paths and replace only their self-contained SVG contents. Add one exact-destination CSS override for the navbar CTA instead of changing the global Airscale primary color, and lock the asset/config/CSS contract with repository tests before browser verification.

**Tech Stack:** Mintlify `docs.json`, SVG, CSS, Node.js test runner, Mint CLI, browser QA.

---

## File map

- `tests/site.test.mjs` — fail-closed branding, SVG safety, and CSS-scope contract.
- `docs.json` — exact `Open Dashboard` label; no other configuration change.
- `logo/light.svg` — black tile, white canonical mark, near-black wordmark.
- `logo/dark.svg` — black tile, white canonical mark, white wordmark.
- `custom.css` — exact navbar-dashboard light/dark color override.

### Task 1: Lock the approved brand contract with failing tests

**Files:**
- Modify: `tests/site.test.mjs:73-125`

- [ ] **Step 1: Change the expected navbar label and require custom CSS**

Replace the current navbar/custom-CSS assertions with:

```js
  assert.deepEqual(config.navbar.primary, {
    type: "button",
    label: "Open Dashboard",
    href: "https://app.airscale.io/dashboard"
  });
  assert.equal(existsSync("custom.css"), true);
```

- [ ] **Step 2: Strengthen the light/dark SVG assertions**

Replace the current two-logo loop with assertions that preserve `CANONICAL_SYMBOL_PATH`, reject unsafe SVG source, and require this structure:

```js
  const logoModes = [
    ["logo/light.svg", "#111827"],
    ["logo/dark.svg", "#FFFFFF"]
  ];
  for (const [path, wordmarkFill] of logoModes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /viewBox="0 0 164 32"/);
    assert.match(source, /<rect x="0" y="2" width="28" height="28" rx="6" fill="#111827"\s*\/>/);
    assert.ok(source.includes(CANONICAL_SYMBOL_PATH), `${path} must include the canonical symbol`);
    assert.match(source, /<path transform="translate\(4\.8 6\.8\) scale\(\.32\)" fill="#FFFFFF"/);
    assert.match(source, new RegExp(`<text[^>]+fill="${wordmarkFill}"[^>]*>Airscale<\\/text>`));
    assert.match(source, /role="img" aria-label="Airscale"/);
    assertSafeSvgSource(source, path);
  }
```

- [ ] **Step 3: Add a narrowly scoped CTA CSS test**

Add this test immediately after the SVG test:

```js
test("navbar dashboard CTA is mode-aware without changing global brand colors", () => {
  const css = readFileSync("custom.css", "utf8");
  const dashboardSelector = '#navbar a[href="https://app.airscale.io/dashboard"]';
  assert.match(css, new RegExp(`${dashboardSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*background-color:\\s*#111827`));
  assert.match(css, /color:\s*#FFFFFF/);
  assert.match(css, new RegExp(`html\\.dark ${dashboardSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*background-color:\\s*#FFFFFF`));
  assert.match(css, /html\.dark[\s\S]*color:\s*#111827/);
  assert.doesNotMatch(css, /(?:^|[},]\s*)(?:body|a|button|#navbar)\s*\{/m);

  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.deepEqual(config.colors, { primary: "#4079FF", light: "#4079FF", dark: "#6F9BFF" });
});
```

- [ ] **Step 4: Run the focused tests and confirm the intended failures**

Run:

```bash
node --test tests/site.test.mjs
```

Expected: failures for the lowercase dashboard label, missing `custom.css`, and old transparent logo structure. Existing unrelated site tests remain green.

- [ ] **Step 5: Commit the test contract**

```bash
git add tests/site.test.mjs
git commit -m "test: lock Mintlify header branding"
```

### Task 2: Implement the logo and CTA treatment

**Files:**
- Modify: `docs.json:60-71`
- Modify: `logo/light.svg`
- Modify: `logo/dark.svg`
- Create: `custom.css`
- Test: `tests/site.test.mjs`

- [ ] **Step 1: Confirm the rendered navbar/theme hooks before CSS implementation**

Start the trusted local preview:

```bash
./node_modules/.bin/mint dev --no-open
```

Open the printed local origin, inspect the dashboard anchor, and toggle dark mode. Confirm the navbar ancestor is `#navbar` and Mintlify applies `dark` to the root `<html>` element. If either hook differs, stop and update the spec/test selector to the observed stable hook before proceeding.

- [ ] **Step 2: Update only the dashboard label in `docs.json`**

```json
"primary": {
  "type": "button",
  "label": "Open Dashboard",
  "href": "https://app.airscale.io/dashboard"
}
```

- [ ] **Step 3: Replace the two logo SVGs using the canonical existing path**

Use this exact structure for `logo/light.svg`, keeping the current canonical `d` value unchanged:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 32" role="img" aria-label="Airscale">
  <rect x="0" y="2" width="28" height="28" rx="6" fill="#111827" />
  <path transform="translate(4.8 6.8) scale(.32)" fill="#FFFFFF" d="m41.368,46.100 2.600,7.900c.700,2.200,2.800,3.600,5,3.600,1.700,0,3.300-.800,4.300-2.200,1-1.400,1.200-3.200.700-4.800l-4.700-13.400-7.900,8.900Zm-26.800-7.200 9-26.600c.5-1.400,1.800-2.300,3.300-2.300s2.800.900,3.300,2.300l6.200,18.500,7.800-8.800-4.600-13.100c-1.900-5.400-7-8.900-12.600-8.900-5.700,0-10.700,3.600-12.600,8.900L.367,48.800c-.700,2.100-.400,4.300.900,6.100,1.300,1.800,3.300,2.800,5.500,2.800,1.900,0,3.700-.800,5-2.200l13.800-15.400,2.800,8.300c.200.700.700,1.300,1.200,1.800s1.200.800,1.900,1c.700.100,1.500.1,2.100-.1.700-.200,1.300-.600,1.800-1.200l21-24.300c.5-.600.900-1.400,1-2.400.200-.9.100-1.9-.1-2.600l-1.700-4.800c-.1-.4-.3-.7-.5-.8-.1-.1-.2-.2-.4-.2h-.4c-.2.1-.5.200-.8.600l-19.800,22.500-2.700-8.100c-.8-3.200-4.900-3.800-7-1.400l-9.9,10.700" />
  <text x="40" y="23" font-family="Poppins, Arial, sans-serif" font-size="20" font-weight="600" fill="#111827">Airscale</text>
</svg>
```

Use the same structure for `logo/dark.svg`, changing only the wordmark fill to `#FFFFFF`. Do not alter the black tile or white mark.

- [ ] **Step 4: Add the exact-destination CTA override**

Create `custom.css`:

```css
#navbar a[href="https://app.airscale.io/dashboard"] {
  background-color: #111827 !important;
  border-color: #111827 !important;
  color: #FFFFFF !important;
}

#navbar a[href="https://app.airscale.io/dashboard"]:hover {
  background-color: #000000 !important;
  border-color: #000000 !important;
}

#navbar a[href="https://app.airscale.io/dashboard"] :is(span, svg) {
  color: inherit !important;
}

#navbar a[href="https://app.airscale.io/dashboard"] > span.absolute.inset-0 {
  background-color: inherit !important;
}

html.dark #navbar a[href="https://app.airscale.io/dashboard"] {
  background-color: #FFFFFF !important;
  border-color: #FFFFFF !important;
  color: #111827 !important;
}

html.dark #navbar a[href="https://app.airscale.io/dashboard"]:hover {
  background-color: #E5E7EB !important;
  border-color: #E5E7EB !important;
}
```

Do not override outline, box shadow, dimensions, position, or global link/button styles.

- [ ] **Step 5: Run the focused tests**

```bash
node --test tests/site.test.mjs
```

Expected: all site tests pass.

- [ ] **Step 6: Validate generated configuration and formatting**

```bash
git diff --check
npm run mint:validate
```

Expected: no whitespace errors; OpenAPI and Mintlify build validation pass.

- [ ] **Step 7: Commit the implementation**

```bash
git add docs.json logo/light.svg logo/dark.svg custom.css
git commit -m "feat: update Mintlify header branding"
```

### Task 3: Verify responsive light/dark rendering

**Files:**
- Verify: `docs.json`
- Verify: `logo/light.svg`
- Verify: `logo/dark.svg`
- Verify: `custom.css`

- [ ] **Step 1: Start or reuse the local Mintlify preview**

```bash
./node_modules/.bin/mint dev --no-open
```

Record the exact port printed by Mintlify; it chooses the first available port from 3000 through 3009.

- [ ] **Step 2: Run the desktop matrix**

At 1440×900 in light and dark modes, verify:

- The real Airscale mark is white and centered in a black rounded tile.
- The adjacent wordmark reads `Airscale` and uses the approved mode color.
- The CTA reads `Open Dashboard` and keeps its destination.
- The CTA is black/white in light mode and white/black in dark mode.
- Hover and keyboard focus remain visible without layout shift.

- [ ] **Step 3: Run the mobile matrix**

At 390×844 in light and dark modes, verify the visible navbar treatment has no clipping, overlap, horizontal overflow, or truncated CTA label. Preserve Mintlify's native mobile navigation behavior.

- [ ] **Step 4: Inspect browser errors**

Confirm no new console errors, missing-asset requests, or failed stylesheet requests occur on the checked page.

- [ ] **Step 5: Run the complete local release gate**

```bash
npm run validate
git status --short
```

Expected: all repository tests and Mintlify build validation pass. Only the intentionally untracked `.superpowers/` visual-companion directory may remain outside Git; it must not be staged or committed.

### Task 4: Publish and verify the Mintlify preview

**Files:**
- Release the commits from Tasks 1-2 and the approved design/plan commits.

- [ ] **Step 1: Push the named branch and create a pull request**

```bash
git push -u origin design/mintlify-header-branding-20260902
gh pr create --repo ViceScale/airscale-docs --base main --head design/mintlify-header-branding-20260902 --title "feat: update Mintlify header branding" --body "Header branding summary and exact validation evidence"
```

The PR body must explicitly state that Framer, DNS, canonicals, indexing, and global primary colors are unchanged.

- [ ] **Step 2: Merge only the reviewed terminal-green head**

Record the PR head SHA, ensure the merge state is clean and checks are terminal, then use `--match-head-commit` when merging. Do not merge a different SHA.

- [ ] **Step 3: Wait for the Mintlify deployment check**

Require the merge commit's `Mintlify Deployment` check to complete successfully. A PR preview check, HTTP 200, or local validation alone is not publication proof.

- [ ] **Step 4: Verify the hosted result**

On `https://airscale.mintlify.app/api-reference/api-overview`, repeat desktop/mobile and light/dark checks. Confirm the exact label, destination, logo treatment, CTA colors, focus/hover behavior, no clipping, and no new browser errors.

- [ ] **Step 5: Report the release boundary**

Report separately:

- Local gate result and test count.
- PR number and reviewed head SHA.
- Merge SHA.
- Mintlify deployment check conclusion.
- Authenticated/user-visible hosted browser proof.
- Confirmation that no Framer, DNS, canonical, indexing, or global color changes occurred.
