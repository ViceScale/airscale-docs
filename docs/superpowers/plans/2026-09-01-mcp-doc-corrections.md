# MCP Documentation Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct and deploy the seven non-domain MCP documentation problems without changing the Framer/Mintlify boundary.

**Architecture:** Keep the operational MCP contract unchanged. Correct source-authored prose, change the catalog and agent-file generators so regenerated artifacts remain safe, and encode every correction in focused tests before running the full release gate.

**Tech Stack:** MDX, Node.js ESM generators, Node test runner, Mintlify CLI, GitHub/Mintlify deployment.

---

### Task 1: Lock the corrected page contracts

**Files:**
- Modify: `tests/mcp-pages.test.mjs`
- Modify: `mcp/airscale-mcp-server.mdx`
- Modify: `mcp/how-to-use-the-airscale-mcp.mdx`
- Modify: `mcp/agent-resources.mdx`

- [ ] Add assertions that batch creation precedes adding contacts, documentation MCP copy discloses `submit_feedback`, the stale server-card row is absent, actual filesystem discovery is documented, flattened alternatives route readers to authoritative prose/OpenAPI, and polling is conditional on queued/running state.
- [ ] Run `node --test tests/mcp-pages.test.mjs` and confirm the new assertions fail for the audited wording.
- [ ] Apply the smallest MDX edits that satisfy those contracts.
- [ ] Re-run `node --test tests/mcp-pages.test.mjs` and confirm it passes.

### Task 2: Make paid catalog examples non-executing

**Files:**
- Modify: `tests/mcp-generation.test.mjs`
- Modify: `scripts/build-mcp-catalog.mjs`
- Regenerate: `mcp/tools.mdx`
- Regenerate: `mcp-tools.txt`

- [ ] Change expected paid-start examples to omit `confirm_credit_spend` and assert that no generated example pre-authorizes spending.
- [ ] Assert that paid-start expected-result copy describes the intentional confirmation-required spend preview and a separate post-approval rerun.
- [ ] Run `node --test tests/mcp-generation.test.mjs` and confirm the new safety assertions fail.
- [ ] Update the generator's paid-start overrides and result copy, then run `npm run mcp:build`.
- [ ] Re-run `node --test tests/mcp-generation.test.mjs` and `npm run mcp:check`.

### Task 3: Correct generated agent guidance

**Files:**
- Modify: `tests/mcp-generation.test.mjs`
- Modify: `scripts/build-agent-files.mjs`
- Regenerate: `skill.md`
- Regenerate: `llms-full.txt`

- [ ] Assert that generated skill guidance distinguishes read-only search/filesystem tools from `submit_feedback`, names actual path discovery, and warns about flattened alternative schemas.
- [ ] Run the focused generation test and confirm it fails.
- [ ] Update `renderSkillModel`, run `npm run agents:build`, and re-run the focused test plus `npm run agents:check`.

### Task 4: Release and hosted proof

**Files:**
- Verify only: all intended changed files

- [ ] Run `git diff --check`, generator checks, `npm test`, and `npm run mint:validate` through `npm run validate`.
- [ ] Review the exact diff and commit the intended documentation-only paths.
- [ ] Push the emergency branch, open and merge a PR only after terminal CI is successful.
- [ ] Verify the exact merged SHA in the Mintlify deployment check.
- [ ] Fetch all six hosted MCP routes and machine-readable artifacts; verify corrected wording and absence of `confirm_credit_spend: true` in published paid examples.
- [ ] Compare live documentation-MCP `tools/list` with the authored mutation-boundary wording and run only no-spend filesystem discovery.

