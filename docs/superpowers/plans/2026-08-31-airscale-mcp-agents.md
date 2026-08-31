# Airscale MCP and Agent Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a developer-first `MCP & Agents` documentation section with six pages, a source-pinned twenty-two-tool catalog, and accurate machine-readable agent resources on the separate Mintlify preview.

**Architecture:** Keep the existing OpenAPI reference untouched and add a peer Mintlify navigation tab. Store the MCP contract as a checked-in JSON snapshot pinned to Airscale source SHA `b06ea2c46276f8415a97721f6901437ce07f13fa`; render the long catalog and custom AI files deterministically from checked-in contracts so freshness can be tested without private-repository access in docs CI. Preserve the four Framer MCP routes, add `/mcp/tools` and `/mcp/agent-resources`, and keep all preview output `noindex` with `airscale.mintlify.app` links.

**Tech Stack:** Mintlify `docs.json`, MDX, Node.js ESM scripts, Node test runner, JSON contracts, Mint CLI 4.2.850.

---

## File map

- `contracts/mcp-tools.json`: source-pinned contract snapshot for all twenty-two tools.
- `scripts/build-mcp-catalog.mjs`: deterministic catalog and JSON-formatted text-manifest generator with `--check` and `--write` modes.
- `scripts/build-agent-files.mjs`: deterministic three-file `llms.txt`, `llms-full.txt`, and `skill.md` generator.
- `mcp/airscale-mcp-server.mdx`: developer-first landing page and security/credit reference.
- `mcp/tools.mdx`: generated one-page tool catalog.
- `mcp/connect-airscale-mcp-to-chatgpt.mdx`: migrated ChatGPT OAuth walkthrough.
- `mcp/connect-airscale-mcp-to-claude.mdx`: migrated Claude OAuth and developer-client walkthrough.
- `mcp/how-to-use-the-airscale-mcp.mdx`: practical count, sample, refine, export workflow.
- `mcp/agent-resources.mdx`: visible product-MCP versus docs-MCP and agent-resource guide.
- `mcp-tools.txt`: public, JSON-formatted twenty-two-tool catalog served through Mintlify's supported text-asset path.
- `llms.txt`: custom preview-host page directory.
- `llms-full.txt`: custom preview-host full corpus generated from navigable MDX.
- `skill.md`: custom Airscale API and MCP skill that overrides stale generated content.
- `docs.json`: add the approved navigation tab without changing the API tab.
- `package.json`: add MCP and agent-file check/build scripts to `validate`.
- `tests/mcp-contract.test.mjs`: contract count, order, schema, spend, and mapping tests.
- `tests/mcp-pages.test.mjs`: navigation, page content, safety, links, and machine-file tests.
- `tests/mcp-generation.test.mjs`: generator freshness, atomicity, and CLI behavior tests.

### Task 1: Lock the twenty-two-tool contract

**Files:**
- Create: `tests/mcp-contract.test.mjs`
- Create: `contracts/mcp-tools.json`

- [ ] **Step 1: Write the failing contract test**

Create `tests/mcp-contract.test.mjs` with exact expectations for source identity, runtime order, category totals, uniqueness, schemas, spend classification, and API mappings:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE_SHA = "b06ea2c46276f8415a97721f6901437ce07f13fa";
const GROUPS = {
  workspace: ["airscale_check_credits"],
  search_and_research: [
    "airscale_find_people",
    "airscale_count_find_people",
    "airscale_find_companies",
    "airscale_find_companies_filter_values",
    "airscale_airsearch"
  ],
  contact_and_profile_enrichment: [
    "airscale_find_email",
    "airscale_find_email_bulk",
    "airscale_find_mobile_phone",
    "airscale_find_personal_email",
    "airscale_find_people_by_url",
    "airscale_extract_people_profile",
    "airscale_extract_company_profile",
    "airscale_reverse_email",
    "airscale_reverse_phone"
  ],
  async_exports_and_managed_batches: [
    "airscale_start_companies_export",
    "airscale_start_people_export",
    "airscale_create_contact_enrichment_batch",
    "airscale_add_contacts_to_enrichment_batch",
    "airscale_start_contact_enrichment_export",
    "airscale_get_export_status",
    "airscale_get_export_file"
  ]
};
const EXPECTED_NAMES = Object.values(GROUPS).flat();

function contract() {
  return JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));
}

test("MCP contract is pinned to the approved Airscale source", () => {
  const manifest = contract();
  assert.equal(manifest.sourceRepository, "ViceScale/airscale-code");
  assert.equal(manifest.sourceSha, SOURCE_SHA);
  assert.deepEqual(manifest.sourceFiles, [
    "mcp/airscale-public-api/src/endpoints.ts",
    "mcp/airscale-public-api/src/exportJobs.ts",
    "mcp/airscale-public-api/src/contactEnrichmentJobs.ts",
    "mcp/airscale-public-api/src/worker.ts"
  ]);
});

test("MCP contract contains the exact twenty-two tools in approved groups", () => {
  const tools = contract().tools;
  assert.equal(tools.length, 22);
  assert.equal(new Set(tools.map(({ name }) => name)).size, 22);
  assert.deepEqual(tools.map(({ name }) => name), EXPECTED_NAMES);
  for (const [category, names] of Object.entries(GROUPS)) {
    assert.deepEqual(tools.filter((tool) => tool.category === category).map(({ name }) => name), names);
  }
});

test("every MCP tool carries a safe complete documentation contract", () => {
  for (const tool of contract().tools) {
    assert.match(tool.name, /^airscale_[a-z_]+$/);
    assert.equal(tool.anchor, tool.name.replaceAll("_", "-"));
    assert.ok(tool.description.length >= 20);
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === "object");
    assert.match(tool.spend.kind, /^(free|variable|paid_export)$/);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, "api_key"), false);
  }
});

test("core tools map one-to-one to approved OpenAPI operations", () => {
  const tools = contract().tools.filter(({ operationId }) => operationId);
  const operations = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8")).operations;
  assert.equal(tools.length, 15);
  assert.deepEqual(
    tools.map(({ operationId }) => operationId).sort(),
    operations.map(({ operationId }) => operationId).sort()
  );
});

test("paid export starts require explicit confirmation and Airsearch costs two credits", () => {
  const tools = new Map(contract().tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "airscale_start_companies_export",
    "airscale_start_people_export",
    "airscale_start_contact_enrichment_export"
  ]) {
    assert.equal(tools.get(name).spend.confirmationField, "confirm_credit_spend");
    assert.deepEqual(tools.get(name).inputSchema.properties.confirm_credit_spend, { type: "boolean" });
  }
  assert.deepEqual(tools.get("airscale_airsearch").spend, { kind: "variable", summary: "2 credits per call" });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test tests/mcp-contract.test.mjs
```

Expected: FAIL because `contracts/mcp-tools.json` does not exist.

- [ ] **Step 3: Add the exact source-pinned manifest**

Create `contracts/mcp-tools.json` from the four source files at SHA `b06ea2c46276f8415a97721f6901437ce07f13fa`. Preserve the approved category order above. Each entry must include:

```json
{
  "name": "airscale_airsearch",
  "anchor": "airscale-airsearch",
  "category": "search_and_research",
  "description": "AI web research agent: ask a natural-language question and optionally specify structured fields to extract. Costs 2 credits per call.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string", "minLength": 1 },
      "response_format": { "type": "object" }
    },
    "required": ["prompt"],
    "additionalProperties": false
  },
  "spend": { "kind": "variable", "summary": "2 credits per call" },
  "asynchronous": false,
  "operationId": "airsearch",
  "apiPage": "/api-reference/airsearch"
}
```

Use the runtime-derived JSON schema for every entry. Export and batch tools have `operationId: null` and `apiPage: null`.

- [ ] **Step 4: Run the contract test and full suite**

Run:

```bash
node --test tests/mcp-contract.test.mjs
npm test
```

Expected: 5 MCP contract tests pass and the existing 116 tests remain green.

- [ ] **Step 5: Commit the contract slice**

```bash
git add contracts/mcp-tools.json tests/mcp-contract.test.mjs
git commit -m "docs: lock MCP tool contract"
```

### Task 2: Generate the catalog and public tool manifest

**Files:**
- Create: `tests/mcp-generation.test.mjs`
- Create: `scripts/build-mcp-catalog.mjs`
- Create: `mcp/tools.mdx`
- Create: `mcp-tools.txt`
- Modify: `package.json`

- [ ] **Step 1: Write failing generator tests**

Test the pure renderer, exact output freshness, rejected CLI arguments, and atomic `--write` behavior:

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderCatalog, renderPublicManifest, run } from "../scripts/build-mcp-catalog.mjs";

const contract = JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));

test("catalog renderer emits every tool once with stable anchors", () => {
  const source = renderCatalog(contract);
  for (const tool of contract.tools) {
    assert.equal(source.match(new RegExp(`<a id="${tool.anchor}"></a>`, "g"))?.length, 1);
    assert.equal(source.match(new RegExp(`## \\`${tool.name}\\``, "g"))?.length, 1);
  }
  assert.match(source, /2 credits per call/);
  assert.match(source, /confirm_credit_spend/);
});

test("public manifest strips source-only fields but preserves all schemas", () => {
  const output = JSON.parse(renderPublicManifest(contract));
  assert.equal(output.tools.length, 22);
  assert.equal(Object.hasOwn(output, "sourceFiles"), false);
  assert.ok(output.tools.every(({ inputSchema }) => inputSchema.type === "object"));
});

test("check mode rejects stale files and accepts exact output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "airscale-mcp-catalog-"));
  const catalogPath = join(directory, "tools.mdx");
  const publicPath = join(directory, "mcp-tools.txt");
  writeFileSync(catalogPath, "stale");
  writeFileSync(publicPath, "stale");
  await assert.rejects(run(["--check", "--catalog", catalogPath, "--public", publicPath]));
  await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
  await run(["--check", "--catalog", catalogPath, "--public", publicPath]);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/mcp-generation.test.mjs
```

Expected: FAIL because `scripts/build-mcp-catalog.mjs` does not exist.

- [ ] **Step 3: Implement deterministic rendering**

Create `scripts/build-mcp-catalog.mjs` with exported `renderCatalog`, `renderPublicManifest`, and `run`. The page renderer must produce this frontmatter and category order:

```mdx
---
title: "MCP tool catalog"
description: "Browse all 22 typed tools exposed by the Airscale MCP server."
canonical: "https://airscale.mintlify.app/mcp/tools"
---

Airscale MCP exposes 22 typed tools for workspace checks, search, enrichment, research, managed batches, and asynchronous exports.

<Warning>
Review each tool's credit behavior before approval. Export-start tools require `confirm_credit_spend: true`.
</Warning>
```

For each category, render a semantic category heading, a compact summary table, and one tool block containing its stable anchor, description, spend callout, input table, synthetic JSON call, result behavior, and related API link. Serialize JSON with two-space indentation and a final newline. Write both files through temporary siblings and rename only after both render successfully.

- [ ] **Step 4: Add scripts and generate outputs**

Add these package scripts:

```json
"mcp:build": "node scripts/build-mcp-catalog.mjs --write",
"mcp:check": "node scripts/build-mcp-catalog.mjs --check"
```

Run:

```bash
npm run mcp:build
node --test tests/mcp-generation.test.mjs
npm run mcp:check
```

Expected: generator tests pass and the generated files are exact.

- [ ] **Step 5: Commit the generated catalog slice**

```bash
git add package.json scripts/build-mcp-catalog.mjs tests/mcp-generation.test.mjs mcp/tools.mdx mcp-tools.txt
git commit -m "docs: generate MCP tool catalog"
```

### Task 3: Add navigation and the developer-first landing page

**Files:**
- Create: `tests/mcp-pages.test.mjs`
- Modify: `docs.json`
- Create: `mcp/airscale-mcp-server.mdx`
- Create temporary minimal pages for the remaining four routes so navigation resolves during this slice.

- [ ] **Step 1: Write failing navigation and landing tests**

Define the exact groups and pages:

```js
const MCP_GROUPS = [
  { group: "Start", pages: ["mcp/airscale-mcp-server", "mcp/tools"] },
  { group: "Connect", pages: ["mcp/connect-airscale-mcp-to-chatgpt", "mcp/connect-airscale-mcp-to-claude"] },
  { group: "Use", pages: ["mcp/how-to-use-the-airscale-mcp"] },
  { group: "For agents", pages: ["mcp/agent-resources"] }
];

test("MCP and Agents is a peer tab with exactly six pages", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.navigation.tabs[0].tab, "API Reference");
  assert.deepEqual(config.navigation.tabs[1], { tab: "MCP & Agents", groups: MCP_GROUPS });
});

test("MCP landing page is developer-first and non-executing", () => {
  const source = readFileSync("mcp/airscale-mcp-server.mdx", "utf8");
  assert.match(source, /title: "Airscale MCP server"/);
  assert.match(source, /canonical: "https:\/\/airscale\.mintlify\.app\/mcp\/airscale-mcp-server"/);
  assert.match(source, /https:\/\/mcp\.airscale\.io\/mcp/);
  assert.match(source, /22 typed tools/);
  assert.match(source, /OAuth/);
  assert.match(source, /Authorization: Bearer \$AIRSCALE_API_KEY/);
  assert.match(source, /confirm_credit_spend/);
  assert.doesNotMatch(source, /<ApiPlayground|<TryIt|api\.airscale\.io\/v1/);
});
```

Also reuse the existing credential guard against all six MCP pages and require exact preview canonicals, balanced fences, no body H1, and resolvable `/mcp/` or `/api-reference/` links.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/mcp-pages.test.mjs
```

Expected: FAIL because the MCP tab and pages do not exist.

- [ ] **Step 3: Add the second navigation tab**

Append this peer tab without changing the existing API groups:

```json
{
  "tab": "MCP & Agents",
  "groups": [
    { "group": "Start", "pages": ["mcp/airscale-mcp-server", "mcp/tools"] },
    { "group": "Connect", "pages": ["mcp/connect-airscale-mcp-to-chatgpt", "mcp/connect-airscale-mcp-to-claude"] },
    { "group": "Use", "pages": ["mcp/how-to-use-the-airscale-mcp"] },
    { "group": "For agents", "pages": ["mcp/agent-resources"] }
  ]
}
```

- [ ] **Step 4: Create the landing page and valid route shells**

Write the complete landing page in the approved order: first viewport, copyable server URL, four cards, static config `CodeGroup`, safe first test, capability overview, exports, credits, security, and troubleshooting. Use `YOUR_API_KEY` only for environment assignment and `$AIRSCALE_API_KEY` in authorization headers. Add valid frontmatter and a meaningful non-placeholder first section to each remaining route so all navigation targets resolve.

- [ ] **Step 5: Run page tests and full suite**

```bash
node --test tests/mcp-pages.test.mjs
npm test
```

Expected: MCP page tests pass and no API-reference test regresses.

- [ ] **Step 6: Commit navigation and landing**

```bash
git add docs.json mcp tests/mcp-pages.test.mjs
git commit -m "docs: add MCP navigation and landing"
```

### Task 4: Migrate the two connection guides and workflow guide

**Files:**
- Modify: `tests/mcp-pages.test.mjs`
- Modify: `mcp/connect-airscale-mcp-to-chatgpt.mdx`
- Modify: `mcp/connect-airscale-mcp-to-claude.mdx`
- Modify: `mcp/how-to-use-the-airscale-mcp.mdx`

- [ ] **Step 1: Add failing content-contract tests**

Require each connect page to contain the exact server URL, prerequisites, OAuth guidance, browser sign-in, free credit-check test, starter prompts, credit warning, troubleshooting, and links to `/mcp/tools` and `/mcp/how-to-use-the-airscale-mcp`.

Require the workflow page to contain these ordered headings:

```js
const WORKFLOW_HEADINGS = [
  "Verify the connection for free",
  "Count or discover filters",
  "Run a narrow sample",
  "Refine the request",
  "Review the maximum spend",
  "Start the export",
  "Poll status",
  "Retrieve the file"
];
```

Assert that paid start examples include `"confirm_credit_spend": true`, polling uses `poll_after_seconds`, and all examples use reserved domains and synthetic identities.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/mcp-pages.test.mjs
```

Expected: FAIL because the minimal route shells lack the required content.

- [ ] **Step 3: Replace shells with migrated content**

Preserve the current public instructions while applying the shared page template. ChatGPT uses browser OAuth and never asks for an API key. Claude web uses browser OAuth; Claude Code additionally receives the approved header-based configuration. The workflow page teaches the free-first, narrow-sample, explicit-confirmation, asynchronous-export sequence without making a request.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/mcp-pages.test.mjs
npm test
git add mcp/connect-airscale-mcp-to-chatgpt.mdx mcp/connect-airscale-mcp-to-claude.mdx mcp/how-to-use-the-airscale-mcp.mdx tests/mcp-pages.test.mjs
git commit -m "docs: migrate MCP connection workflows"
```

### Task 5: Add accurate agent resources on Mintlify-supported publication paths

> **Review supersession:** Mintlify CLI 4.2.850 prebuild testing showed that authored non-OpenAPI JSON files are not copied to public build output. That makes the original five-output agent generator infeasible: `/mcp-tools.json` and `/.well-known/agent-card.json` would not publish, and the extensionless `/.well-known/api-catalog` cannot provide a standards-correct Linkset content type through this configuration. The accepted implementation therefore uses three custom agent outputs (`llms.txt`, `llms-full.txt`, and `skill.md`), publishes the JSON-formatted tool snapshot separately at the supported `/mcp-tools.txt` text path, and relies on Mintlify-generated discovery endpoints. No authored API catalog or Agent Card is shipped.

**Files:**
- Modify: `tests/mcp-pages.test.mjs`
- Modify: `tests/mcp-generation.test.mjs`
- Modify: `scripts/build-agent-files.mjs`
- Modify: `scripts/build-mcp-catalog.mjs`
- Modify: `scripts/lib/atomic-generated-pair.mjs`
- Modify: `mcp/agent-resources.mdx`
- Modify: `llms.txt`
- Modify: `llms-full.txt`
- Modify: `skill.md`
- Rename superseded draft: `mcp-tools.json` to `mcp-tools.txt`
- Remove superseded drafts: `.well-known/api-catalog`, `.well-known/agent-card.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing agent-resource tests**

Require the page to name both endpoints and their trust boundaries:

```js
assert.match(source, /https:\/\/mcp\.airscale\.io\/mcp/);
assert.match(source, /https:\/\/airscale\.mintlify\.app\/mcp/);
assert.match(source, /authenticated product server/i);
assert.match(source, /read-only documentation/i);
```

Require every custom machine file to contain only preview-host documentation URLs, reject `https://docs.airscale.io`, require `skill.md` to state Airsearch's two-credit cost and MCP paid-export confirmation, and require links to `/openapi.json`, `/mcp-tools.txt`, `/mcp`, `/skill.md`, and `/.well-known/agent-skills/index.json` as appropriate. Add a real Mintlify cold-build and update-build publication test: `mcp-tools.txt`, `llms.txt`, and `llms-full.txt` must appear byte-for-byte in public prebuild output, while `skill.md` must retain Mintlify's supported `skillFile` classification. The test must reject authored `/mcp-tools.json`, `/.well-known/api-catalog`, and `/.well-known/agent-card.json` artifacts.

Also test the shared multi-output transaction entry point before mutation. It must reject canonical aliases, existing hardlink aliases, ancestor/descendant targets, and bidirectional journal/lock/stage/candidate/stale/tmp/bak namespace collisions. Both `--check` and a fresh `--write` must reject a deterministic output-to-symlink swap after path validation.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/mcp-generation.test.mjs tests/mcp-pages.test.mjs
```

Expected: FAIL because the generator and custom resources do not exist.

- [ ] **Step 3: Implement the deterministic agent-file generator**

`scripts/build-agent-files.mjs` reads `docs.json`, all navigable MDX pages, `openapi.json`, and `mcp-tools.txt`. It exports pure renderers and supports atomic three-output `--write` and exact-byte `--check` modes.

The custom `skill.md` begins:

```md
---
name: airscale
description: Search for people and companies, enrich professional contact data, run web research, and create asynchronous exports through the Airscale API or MCP server.
metadata:
  version: "1.0"
  source_sha: "b06ea2c46276f8415a97721f6901437ce07f13fa"
---
```

It describes API and MCP authentication separately, starts with free checks, states Airsearch's two-credit cost, requires explicit confirmation for paid exports, and links to preview-host canonical detail. The lowercase `name: airscale` follows the current skill-file naming requirement.

- [ ] **Step 4: Complete the visible agent-resources page**

Use two adjacent cards for the operational and documentation MCP surfaces, followed by a resource table for OpenAPI, `/mcp-tools.txt`, live authenticated MCP `tools/list`, llms files, Markdown, skill discovery, the Mintlify-generated MCP server card, and Mintlify-generated agent discovery. State that generated agent discovery is documentation metadata, not an Airscale product-agent endpoint or interactive API. Include client connection examples for the documentation MCP only; do not configure the operational server in that subsection.

- [ ] **Step 5: Add scripts, generate, test, and commit**

Add:

```json
"agents:build": "node scripts/build-agent-files.mjs --write",
"agents:check": "node scripts/build-agent-files.mjs --check"
```

Run:

```bash
npm run agents:build
npm run agents:check
node --test tests/mcp-generation.test.mjs tests/mcp-pages.test.mjs
npm test
git add package.json scripts/build-agent-files.mjs scripts/lib/atomic-generated-pair.mjs scripts/build-mcp-catalog.mjs tests/mcp-generation.test.mjs tests/mcp-pages.test.mjs mcp/agent-resources.mdx mcp-tools.txt llms.txt llms-full.txt skill.md
git commit -m "docs: publish MCP agent resources"
```

### Task 6: Integrate validation and run local browser QA

**Files:**
- Modify: `package.json`
- Modify: `tests/site.test.mjs` only if shared page discovery must include the new root.

- [ ] **Step 1: Add failing validation-contract assertion**

Require `package.json` to run generation freshness before content tests:

```js
assert.equal(
  scripts.validate,
  "npm run openapi:check && npm run mcp:check && npm run agents:check && npm test && npm run mint:validate"
);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/mcp-generation.test.mjs
```

Expected: FAIL because `validate` does not contain the MCP and agent checks.

- [ ] **Step 3: Update validation and run the complete local gate**

Set:

```json
"validate": "npm run openapi:check && npm run mcp:check && npm run agents:check && npm test && npm run mint:validate"
```

Run:

```bash
npm run validate
```

Expected: all generators are fresh, all Node tests pass, and Mint validation exits 0.

- [ ] **Step 4: Start Mintlify locally and run the browser matrix**

Start the pinned local CLI without opening a browser. Mint 4.2.850 does not expose a `--port` option; it selects the first free port from 3000 through 3009. Record the URL printed by the CLI and use that exact origin for the browser matrix:

```bash
npm exec -- mint dev --no-open
```

Verify the six MCP routes at wide desktop, 1200-pixel laptop, and 390-pixel mobile in light and dark themes. Check the top, middle, and bottom of the long catalog; keyboard navigation; code copy controls; wrapping; horizontal overflow; internal links; and relevant console/network output. Confirm no request reaches `api.airscale.io` or the operational `/mcp` endpoint.

- [ ] **Step 5: Commit validation integration**

```bash
git add package.json tests
git commit -m "test: gate MCP documentation output"
```

### Task 7: Final review and branch handoff

**Files:**
- Review all changed files.

- [ ] **Step 1: Reconcile implementation against the approved design**

Check all acceptance criteria in `docs/superpowers/specs/2026-08-31-airscale-mcp-agents-design.md`. Confirm exactly six pages, exactly twenty-two tools, the approved category totals, preview-only URLs, no DNS configuration, and no live execution surface.

- [ ] **Step 2: Run fresh final verification**

```bash
npm run validate
git diff --check origin/main...HEAD
git status --short
```

Expected: validation exits 0, diff check is empty, and the worktree contains no uncommitted files.

- [ ] **Step 3: Inspect commit and diff boundaries**

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
```

Confirm only the docs design, plan, contracts, generators, tests, MCP pages, agent files, and configuration changed.

- [ ] **Step 4: Hand off without merging or deploying**

Report the branch name, commits, test counts, Mint validation result, and local browser matrix. Do not push, open a PR, merge, deploy, or change DNS until separately authorized.

After a separately authorized preview deployment, the publication gate is a fresh `GET https://airscale.mintlify.app/mcp-tools.txt`: require HTTP 200, a `text/plain` content type, and exact response bytes matching the committed `mcp-tools.txt`. Repeat once after the deployment has settled. Until that hosted check passes, report the manifest as locally build-verified but not confirmed hosted.
