# Airscale Preview Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a fail-closed, preview-only documentation foundation with explicit no-DNS policy, page-level preview canonicals, search-engine `noindex`, and a classified inventory of all 82 existing Framer routes.

**Architecture:** Keep publication policy in a small JSON contract that tests can enforce independently of prose. Apply preview metadata deterministically to every current MDX page, and capture the live Framer sitemap through a read-only script that classifies each route without modifying Framer, DNS, or production data. This is Plan 1 of 4; it deliberately precedes the OpenAPI reference, product-content migration, and AI-surface plans so those plans can use an exact route inventory and safety contract.

**Tech Stack:** Node.js ESM, Node test runner, JSON, MDX frontmatter, Mintlify `docs.json`, Mint CLI, Git.

---

## Plan decomposition

The approved specification covers four independently testable delivery units:

1. **This plan — preview safety and route inventory.** Produces the publication policy, preview metadata, and exact Framer-route inventory.
2. **OpenAPI reference plan.** Produces `/openapi.json`, operation-level MDX wrappers, POST/GET navigation, and right-side examples.
3. **Product knowledge-base plan.** Produces the balanced gateway and migrates the inventoried product, use-case, MCP, and integration pages.
4. **Agent surfaces and hosted QA plan.** Produces or verifies `llms.txt`, `llms-full.txt`, `skill.md`, API catalog, MCP discovery, preview search, and the hosted browser matrix.

Do not begin Plan 2 until this plan is complete. The inventory created here is an input to Plans 2 and 3. No plan may alter `docs.airscale.io`, its DNS, or the Framer deployment.

## File map

### Create

- `contracts/publication-policy.json` — machine-enforceable preview origin and no-live-mutation policy.
- `tests/preview-safety.test.mjs` — validates `docs.json`, publication policy, and MDX canonical metadata.
- `scripts/set-preview-canonicals.mjs` — deterministic bulk updater for canonical frontmatter on content pages.
- `scripts/capture-framer-sitemap.mjs` — read-only sitemap fetcher with `--write` and `--check` modes.
- `inventory/framer-routes.json` — timestamped, classified snapshot of the 82 live Framer routes.
- `tests/inventory.test.mjs` — validates route count, uniqueness, classifications, targets, and no-DNS boundaries.

### Modify

- `docs.json` — add site description, preview `noindex`, and a documentation search prompt.
- `.gitignore` — ignore the local dependency install used by the reproducible docs toolchain.
- `package.json` — add deterministic metadata and inventory commands plus the pinned Mint validation toolchain.
- `package-lock.json` — lock the exact Mint CLI dependency and its transitive packages.
- `api-reference/*.mdx` — add page-specific preview canonical metadata only; do not rewrite page bodies in this plan.

### Read only

- `contracts/public-api-contracts.json` — current contract baseline; no source SHA update in this plan.
- `docs/superpowers/specs/2026-08-30-airscale-knowledge-base-design.md` — approved design authority.
- `https://docs.airscale.io/sitemap.xml` — live route inventory source; GET only.

---

### Task 1: Add and enforce the preview publication policy

**Files:**

- Create: `contracts/publication-policy.json`
- Create: `tests/preview-safety.test.mjs`
- Modify: `docs.json`

- [ ] **Step 1: Write the failing publication-policy tests**

Create `tests/preview-safety.test.mjs` with this complete content:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = JSON.parse(readFileSync("contracts/publication-policy.json", "utf8"));
const config = JSON.parse(readFileSync("docs.json", "utf8"));

test("publication policy is preview-only and forbids live-domain mutations", () => {
  assert.deepEqual(policy, {
    previewOrigin: "https://airscale.mintlify.app",
    liveDocumentationOrigin: "https://docs.airscale.io",
    previewRobots: "noindex, follow",
    dnsChangesAllowed: false,
    liveRedirectsAllowed: false,
    liveSiteWritesAllowed: false
  });
});

test("docs configuration identifies the complete knowledge base and keeps the preview noindex", () => {
  assert.equal(
    config.description,
    "Airscale product guides, integration workflows, MCP documentation, and public API reference."
  );
  assert.equal(config.seo.indexing, "navigable");
  assert.equal(config.seo.metatags.robots, policy.previewRobots);
  assert.equal(config.search.prompt, "Search Airscale documentation...");
});

test("foundation config does not declare live-domain redirects", () => {
  assert.equal(Object.hasOwn(config, "redirects"), false);
  assert.equal(policy.dnsChangesAllowed, false);
  assert.equal(policy.liveRedirectsAllowed, false);
  assert.equal(policy.liveSiteWritesAllowed, false);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/preview-safety.test.mjs
```

Expected: FAIL with `ENOENT` for `contracts/publication-policy.json`.

- [ ] **Step 3: Create the publication policy**

Create `contracts/publication-policy.json`:

```json
{
  "previewOrigin": "https://airscale.mintlify.app",
  "liveDocumentationOrigin": "https://docs.airscale.io",
  "previewRobots": "noindex, follow",
  "dnsChangesAllowed": false,
  "liveRedirectsAllowed": false,
  "liveSiteWritesAllowed": false
}
```

- [ ] **Step 4: Add preview metadata to `docs.json`**

Add these top-level fields after `"name": "Airscale API"` and before `"colors"`:

```json
"description": "Airscale product guides, integration workflows, MCP documentation, and public API reference.",
"seo": {
  "indexing": "navigable",
  "metatags": {
    "robots": "noindex, follow"
  }
},
"search": {
  "prompt": "Search Airscale documentation..."
},
```

Do not add `redirects`, a custom domain, or any DNS-related setting.

- [ ] **Step 5: Run the focused test and Mintlify validation**

Run:

```bash
node --test tests/preview-safety.test.mjs
npm run mint:validate
```

Expected:

- `tests 3`, `pass 3`, `fail 0` from the focused test.
- Mintlify validation completes with no configuration errors.

- [ ] **Step 6: Commit the publication policy**

```bash
git add contracts/publication-policy.json tests/preview-safety.test.mjs docs.json
git commit -m "docs: enforce preview-only publication policy"
```

---

### Task 2: Add deterministic page-level preview canonicals

**Files:**

- Create: `scripts/set-preview-canonicals.mjs`
- Modify: `tests/preview-safety.test.mjs`
- Modify: `api-reference/airsearch.mdx`
- Modify: `api-reference/api-overview.mdx`
- Modify: `api-reference/authentication.mdx`
- Modify: `api-reference/credit-count.mdx`
- Modify: `api-reference/email-finder-(bulk).mdx`
- Modify: `api-reference/email-finder.mdx`
- Modify: `api-reference/extract-company-profile.mdx`
- Modify: `api-reference/extract-people-profile.mdx`
- Modify: `api-reference/find-companies.mdx`
- Modify: `api-reference/find-people.mdx`
- Modify: `api-reference/mobile-finder.mdx`
- Modify: `api-reference/people-url-finder.mdx`
- Modify: `api-reference/personal-email.mdx`
- Modify: `api-reference/rate-limits.mdx`
- Modify: `api-reference/reverse-email.mdx`
- Modify: `api-reference/reverse-phone.mdx`
- Modify: `package.json`

- [ ] **Step 1: Extend the safety test with frontmatter parsing and canonical assertions**

Append the imports and helpers below to `tests/preview-safety.test.mjs`. Merge `readdirSync` into the existing `node:fs` import rather than adding a duplicate import.

```js
import { readdirSync, readFileSync } from "node:fs";

function mdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxFiles(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

function frontmatterValue(source, key, path) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must start with YAML frontmatter`);
  const line = match[1].split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  assert.ok(line, `${path} must define ${key}`);
  return JSON.parse(line.slice(key.length + 1).trim());
}
```

Append this test after the existing three tests:

```js
test("every current content page declares its preview-host canonical", () => {
  const files = mdxFiles("api-reference");
  assert.equal(files.length, 16);

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const route = path.replace(/\.mdx$/, "");
    assert.equal(frontmatterValue(source, "canonical", path), `${policy.previewOrigin}/${route}`);
  }
});
```

- [ ] **Step 2: Run the focused test to verify canonical coverage fails**

Run:

```bash
node --test tests/preview-safety.test.mjs
```

Expected: the first three tests pass and `every current content page declares its preview-host canonical` fails because `canonical` is missing.

- [ ] **Step 3: Create the deterministic canonical updater**

Create `scripts/set-preview-canonicals.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const PREVIEW_ORIGIN = "https://airscale.mintlify.app";
const CONTENT_ROOTS = ["api-reference"];

function mdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxFiles(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

function canonicalFor(path) {
  return `${PREVIEW_ORIGIN}/${path.replace(/\.mdx$/, "")}`;
}

function updateFrontmatter(path) {
  const source = readFileSync(path, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} must start with YAML frontmatter`);

  const lines = match[1].split("\n");
  const canonical = `canonical: ${JSON.stringify(canonicalFor(path))}`;
  const currentIndex = lines.findIndex((line) => line.startsWith("canonical:"));

  if (currentIndex >= 0) {
    lines[currentIndex] = canonical;
  } else {
    const descriptionIndex = lines.findIndex((line) => line.startsWith("description:"));
    if (descriptionIndex < 0) throw new Error(`${path} must define description before canonical`);
    lines.splice(descriptionIndex + 1, 0, canonical);
  }

  const nextFrontmatter = `---\n${lines.join("\n")}\n---`;
  const nextSource = source.replace(match[0], nextFrontmatter);
  if (nextSource !== source) writeFileSync(path, nextSource);
}

const files = CONTENT_ROOTS.flatMap(mdxFiles);
for (const path of files) updateFrontmatter(path);
// The hardened CLI reports: Scanned 16 MDX pages; updated 0.
```

- [ ] **Step 4: Add the canonical command to `package.json`**

Change the scripts object to:

```json
"scripts": {
  "metadata:sync": "node scripts/set-preview-canonicals.mjs",
  "test": "node --test tests/*.test.mjs",
  "mint:validate": "mint validate",
  "validate": "npm test && npm run mint:validate"
}
```

- [ ] **Step 5: Apply canonical metadata mechanically**

Run:

```bash
npm run metadata:sync
```

Expected: `Scanned 16 MDX pages; updated 0.`

Verify one representative page begins with:

```mdx
---
title: "Find people"
description: "Search and count people using person, role, and company filters."
canonical: "https://airscale.mintlify.app/api-reference/find-people"
---
```

- [ ] **Step 6: Run focused and full validation**

Run:

```bash
node --test tests/preview-safety.test.mjs
npm test
npm run mint:validate
git diff --check
```

Expected:

- Preview-safety tests: `tests 4`, `pass 4`, `fail 0`.
- Full Node suite: all tests pass.
- Mintlify validation passes.
- `git diff --check` prints no output.

- [ ] **Step 7: Commit canonical metadata**

```bash
git add scripts/set-preview-canonicals.mjs tests/preview-safety.test.mjs package.json api-reference
git commit -m "docs: pin page canonicals to preview host"
```

---

### Task 3: Create the classified Framer sitemap inventory

**Files:**

- Create: `scripts/capture-framer-sitemap.mjs`
- Create: `inventory/framer-routes.json`
- Create: `tests/inventory.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing inventory contract test**

Create `tests/inventory.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventory = JSON.parse(readFileSync("inventory/framer-routes.json", "utf8"));
const policy = JSON.parse(readFileSync("contracts/publication-policy.json", "utf8"));

const expectedCounts = {
  migrate: 60,
  rewrite: 17,
  consolidate: 3,
  omit: 2
};

const expectedConsolidations = new Map([
  ["/api-reference/connect-airscale-mcp-to-chatgpt", "/mcp/connect-airscale-mcp-to-chatgpt"],
  ["/api-reference/connect-airscale-mcp-to-claude", "/mcp/connect-airscale-mcp-to-claude"],
  ["/api-reference/airscale-mcp-server", "/mcp/airscale-mcp-server"]
]);

const expectedOmissions = new Set([
  "/api-reference/dnc-checker",
  "/api-reference/leads-finder"
]);

test("inventory is a timestamped snapshot of exactly 82 unique Framer routes", () => {
  assert.equal(inventory.sourceUrl, `${policy.liveDocumentationOrigin}/sitemap.xml`);
  assert.match(inventory.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(inventory.routes.length, 82);
  assert.equal(new Set(inventory.routes.map(({ path }) => path)).size, 82);
  assert.equal(inventory.routes[0].path, "/");
});

test("every route has one complete preview disposition", () => {
  const counts = Object.fromEntries(Object.keys(expectedCounts).map((key) => [key, 0]));

  for (const route of inventory.routes) {
    assert.match(route.path, /^\//);
    assert.ok(Object.hasOwn(expectedCounts, route.disposition), `${route.path} has invalid disposition`);
    assert.equal(typeof route.category, "string");
    assert.ok(route.category.length > 0, `${route.path} must have a category`);
    assert.equal(typeof route.reason, "string");
    assert.ok(route.reason.length > 0, `${route.path} must have a reason`);
    counts[route.disposition] += 1;

    if (route.disposition === "migrate" || route.disposition === "rewrite") {
      assert.equal(route.targetPath, route.path);
    }
    if (route.disposition === "omit") {
      assert.equal(route.targetPath, null);
    }
  }

  assert.deepEqual(counts, expectedCounts);
});

test("duplicate MCP references consolidate only inside the preview route model", () => {
  for (const [path, targetPath] of expectedConsolidations) {
    const route = inventory.routes.find((candidate) => candidate.path === path);
    assert.deepEqual(
      { disposition: route?.disposition, targetPath: route?.targetPath },
      { disposition: "consolidate", targetPath }
    );
  }
});

test("unapproved API pages are omitted from the preview API reference", () => {
  const omitted = new Set(
    inventory.routes.filter(({ disposition }) => disposition === "omit").map(({ path }) => path)
  );
  assert.deepEqual(omitted, expectedOmissions);
});

test("inventory cannot authorize DNS, redirects, or writes to the live site", () => {
  assert.equal(policy.dnsChangesAllowed, false);
  assert.equal(policy.liveRedirectsAllowed, false);
  assert.equal(policy.liveSiteWritesAllowed, false);
  assert.equal(Object.hasOwn(inventory, "dns"), false);
  assert.equal(Object.hasOwn(inventory, "redirects"), false);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/inventory.test.mjs
```

Expected: FAIL with `ENOENT` for `inventory/framer-routes.json`.

- [ ] **Step 3: Create the read-only sitemap capture script**

Create `scripts/capture-framer-sitemap.mjs`:

```js
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE_URL = "https://docs.airscale.io/sitemap.xml";
const OUTPUT_PATH = "inventory/framer-routes.json";

const approvedApiPaths = new Set([
  "/api-reference/api-overview",
  "/api-reference/authentication",
  "/api-reference/rate-limits",
  "/api-reference/credit-count",
  "/api-reference/email-finder",
  "/api-reference/email-finder-(bulk)",
  "/api-reference/mobile-finder",
  "/api-reference/personal-email",
  "/api-reference/people-url-finder",
  "/api-reference/extract-people-profile",
  "/api-reference/extract-company-profile",
  "/api-reference/reverse-email",
  "/api-reference/reverse-phone",
  "/api-reference/find-people",
  "/api-reference/find-companies",
  "/api-reference/airsearch"
]);

const consolidations = new Map([
  ["/api-reference/connect-airscale-mcp-to-chatgpt", "/mcp/connect-airscale-mcp-to-chatgpt"],
  ["/api-reference/connect-airscale-mcp-to-claude", "/mcp/connect-airscale-mcp-to-claude"],
  ["/api-reference/airscale-mcp-server", "/mcp/airscale-mcp-server"]
]);

const omissions = new Map([
  ["/api-reference/dnc-checker", "No approved public operation exists in the locked API contract manifest."],
  ["/api-reference/leads-finder", "The retired Leads Finder API page is excluded from the approved public reference."]
]);

function categoryFor(path) {
  if (path === "/") return "home";
  if (path.startsWith("/usecases/")) return "use-case";
  if (path.startsWith("/api-reference/")) return "api-reference";
  if (path.startsWith("/mcp/")) return "mcp";
  if (path.startsWith("/docs/")) return "product-guide";
  throw new Error(`Unclassified Framer path: ${path}`);
}

function classify(path) {
  const category = categoryFor(path);
  if (path === "/") {
    return {
      path,
      category,
      disposition: "rewrite",
      targetPath: path,
      reason: "Replace the preview homepage with the approved balanced two-path gateway."
    };
  }
  if (approvedApiPaths.has(path)) {
    return {
      path,
      category,
      disposition: "rewrite",
      targetPath: path,
      reason: "Convert the approved public API page to the OpenAPI-plus-MDX reference model."
    };
  }
  if (consolidations.has(path)) {
    return {
      path,
      category,
      disposition: "consolidate",
      targetPath: consolidations.get(path),
      reason: "Use the canonical MCP guide in the preview navigation instead of duplicate API-reference content."
    };
  }
  if (omissions.has(path)) {
    return {
      path,
      category,
      disposition: "omit",
      targetPath: null,
      reason: omissions.get(path)
    };
  }
  if (category === "use-case" || category === "mcp" || category === "product-guide") {
    return {
      path,
      category,
      disposition: "migrate",
      targetPath: path,
      reason: "Preserve this public product-learning route on the separate preview host."
    };
  }
  throw new Error(`No disposition for Framer path: ${path}`);
}

function parsePaths(xml) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
  for (const url of urls) assert.equal(url.origin, "https://docs.airscale.io");
  return urls.map(({ pathname }) => pathname).map((path) => path || "/");
}

async function livePaths() {
  const response = await fetch(SOURCE_URL, { headers: { accept: "application/xml" } });
  if (!response.ok) throw new Error(`Sitemap request failed with ${response.status}`);
  const paths = parsePaths(await response.text());
  assert.equal(paths.length, 82, "Framer sitemap route count changed; inspect before refreshing inventory");
  assert.equal(new Set(paths).size, paths.length, "Framer sitemap contains duplicate paths");
  return paths;
}

const mode = process.argv[2];
const paths = await livePaths();

if (mode === "--write") {
  const inventory = {
    sourceUrl: SOURCE_URL,
    capturedAt: new Date().toISOString(),
    routes: paths.map(classify)
  };
  mkdirSync("inventory", { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Captured and classified ${inventory.routes.length} Framer routes.`);
} else if (mode === "--check") {
  const inventory = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  assert.deepEqual(
    paths,
    inventory.routes.map(({ path }) => path),
    "Live Framer sitemap differs from the committed inventory"
  );
  console.log(`Framer sitemap matches inventory (${paths.length} routes).`);
} else {
  throw new Error("Use --write to refresh inventory or --check to compare without writing.");
}
```

The script performs only an HTTP GET. It contains no API for DNS, Framer writes, redirects, or publication.

- [ ] **Step 4: Add inventory commands to `package.json`**

Change the scripts object to:

```json
"scripts": {
  "inventory:check": "node scripts/capture-framer-sitemap.mjs --check",
  "inventory:refresh": "node scripts/capture-framer-sitemap.mjs --write",
  "metadata:sync": "node scripts/set-preview-canonicals.mjs",
  "test": "node --test tests/*.test.mjs",
  "mint:validate": "mint validate",
  "validate": "npm test && npm run mint:validate"
}
```

- [ ] **Step 5: Generate the inventory from the live sitemap**

Run:

```bash
npm run inventory:refresh
```

Expected: `Captured and classified 82 Framer routes.`

This command is read-only against `docs.airscale.io`; its only write is the local `inventory/framer-routes.json` file.

- [ ] **Step 6: Run inventory tests and drift check**

Run:

```bash
node --test tests/inventory.test.mjs
npm run inventory:check
```

Expected:

- Inventory tests: `tests 5`, `pass 5`, `fail 0`.
- Drift check: `Framer sitemap matches inventory (82 routes).`

- [ ] **Step 7: Commit the inventory**

```bash
git add scripts/capture-framer-sitemap.mjs inventory/framer-routes.json tests/inventory.test.mjs package.json
git commit -m "docs: inventory Framer routes for preview migration"
```

---

### Task 4: Add fail-closed regression checks for generated metadata

**Files:**

- Modify: `tests/preview-safety.test.mjs`
- Modify: `tests/inventory.test.mjs`

- [ ] **Step 1: Add a mutation test for canonical generation**

Append this pure helper and test to `tests/preview-safety.test.mjs`:

```js
function expectedCanonical(path) {
  return `${policy.previewOrigin}/${path.replace(/\.mdx$/, "")}`;
}

test("canonical generation cannot target the live documentation origin", () => {
  const canonical = expectedCanonical("api-reference/find-people.mdx");
  assert.equal(canonical, "https://airscale.mintlify.app/api-reference/find-people");
  assert.equal(canonical.startsWith(policy.liveDocumentationOrigin), false);
});
```

Update the earlier canonical test to call `expectedCanonical(path)` instead of constructing the string inline:

```js
assert.equal(frontmatterValue(source, "canonical", path), expectedCanonical(path));
```

- [ ] **Step 2: Add exact category-count coverage to the inventory test**

Append this test to `tests/inventory.test.mjs`:

```js
test("inventory preserves the complete legacy content-category denominator", () => {
  const categoryCounts = inventory.routes.reduce((counts, { category }) => {
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(categoryCounts, {
    home: 1,
    "use-case": 8,
    "api-reference": 21,
    mcp: 4,
    "product-guide": 48
  });
});
```

- [ ] **Step 3: Run the two focused suites**

Run:

```bash
node --test tests/preview-safety.test.mjs tests/inventory.test.mjs
```

Expected: `tests 30`, `pass 30`, `fail 0` (15 preview-safety + 15 inventory). Task 5's package-toolchain test brings the full suite to 50 tests.

- [ ] **Step 4: Commit the fail-closed checks**

```bash
git add tests/preview-safety.test.mjs tests/inventory.test.mjs
git commit -m "test: fail closed on preview host and inventory drift"
```

---

### Task 5: Run the foundation release gate and record handoff evidence

**Files:**

- Modify only if verification exposes a defect in files owned by Tasks 1-4.

- [ ] **Step 1: Install and record the pinned toolchain**

Run:

```bash
npm ci
node --version
npm --version
npm ls mint --depth=0
```

Expected: `npm ci` succeeds, and `npm ls mint --depth=0` reports the exact `mint@4.2.850` dependency from `package-lock.json`.

- [ ] **Step 2: Verify generated metadata is idempotent**

Run:

```bash
npm run metadata:sync
git diff --exit-code -- api-reference
```

Expected:

- `Scanned 16 MDX pages; updated 0.`
- `git diff --exit-code -- api-reference` exits 0 and prints no diff.

- [ ] **Step 3: Run the complete local documentation gate and dependency audit**

Run:

```bash
node --test tests/preview-safety.test.mjs
npm test
npm run mint:validate
npm run validate
npm audit --omit=dev
npm audit
```

Expected:

- Focused preview tests pass.
- All Node tests pass with zero failures.
- Both local Mint validation invocations pass using the pinned `mint@4.2.850` binary.
- `npm audit --omit=dev` exits 0 with zero production/runtime findings.
- Full `npm audit` exits 1 with 14 vulnerable package entries (12 high, 2 moderate), propagated from three transitive advisory roots: `extract-zip` (`GHSA-jmr9-qjv8-65gv`), `qs` (`GHSA-q8mj-m7cp-5q26`), and `sharp` (`GHSA-f88m-g3jw-g9cj`). This is a count of vulnerable package entries, not 14 independent advisories.
- Mint is dev-only and exact-pinned; the current repository favicon/input is controlled. Run Mint validation only on trusted changes, or in ephemeral credential-free/no-secret CI for untrusted changes; do not run `mint dev` on untrusted branches.
- Do not use `npm audit fix --force` or unsupported dependency overrides; monitor pinned Mint releases for corrected transitive dependencies.
- Record both audit outputs without masking unexpected results.

- [ ] **Step 4: Verify the committed inventory still matches the live sitemap**

Run:

```bash
npm run inventory:check
```

Expected: `Framer sitemap matches inventory (82 routes).`

If the route count or paths changed, stop. Refreshing and reclassifying a changed live sitemap requires review of the new paths before updating the committed inventory.

- [ ] **Step 5: Run repository, index, and cross-base whitespace checks**

Run:

```bash
git diff --check
git diff --cached --check
git diff --check origin/main...HEAD
```

Expected: all three commands exit 0 and print no whitespace errors.

- [ ] **Step 6: Verify the live DNS target was not changed**

Run this read-only query:

```bash
dig +short docs.airscale.io CNAME
```

Expected at the time of this plan: `sites.framer.app.`

Do not run any DNS mutation command even if the result differs. Report external drift instead.

- [ ] **Step 7: Verify branch, index, working-tree, and commit state**

Run:

```bash
git status --short --branch
git diff --quiet
git diff --cached --quiet
git log --oneline --decorate -12
```

Expected:

- Tracked files and the index are clean after the focused commit; five documented untracked `.superpowers/brainstorm/...` artifacts remain visible.
- `node_modules` is ignored and does not appear in status.
- Tasks 1-4 appear as separate commits.
- No mutating code or commands were observed during this executed plan. Current DNS remains unchanged based on the read-only lookup. Current remote branch/PR state may be checked separately with read-only GitHub queries, but this local gate does not prove historical absence of external activity.

- [ ] **Step 8: Record the bounded network and safety evidence**

The allowed network reads for this plan are:

- one bounded `GET https://docs.airscale.io/sitemap.xml` from `npm run inventory:check`;
- DNS resolution for `docs.airscale.io` via `dig`;
- npm dependency installation/resolution required by `npm ci` and the pinned lockfile;
- Mint validation traffic from the local `mint validate` binary; and
- any explicitly recorded read-only GitHub remote/PR queries (none are implied unless actually run).

Record that no mutating code or commands were observed during this executed plan; no Airscale public API calls, credit spend, provider-quota use, production mutations, DNS/custom-domain/redirect changes, or live Framer writes were performed. Do not broaden that statement into a claim about all historical external activity.

- [ ] **Step 9: Stop after the foundation checkpoint**

Report these exact outputs before starting the OpenAPI reference plan:

- Node and npm versions;
- `npm ls mint --depth=0` exact version;
- test total and failure count;
- Mintlify validation result;
- `npm audit --omit=dev` result (expected exit 0 with zero production/runtime findings);
- full `npm audit` result (expected exit 1 with 14 vulnerable package entries and the three advisory roots above);
- metadata changed count;
- inventory denominator `82` and disposition counts `60/17/3/2`;
- exact branch HEAD SHA;
- read-only DNS result;
- tracked/index/working-tree status, including the five documented `.superpowers/brainstorm/...` artifacts; and
- the bounded network and no-mutation evidence described above.

Do not implement OpenAPI pages or product-guide migrations as unplanned follow-on work. Create and review Plan 2 using the completed foundation artifacts first.
