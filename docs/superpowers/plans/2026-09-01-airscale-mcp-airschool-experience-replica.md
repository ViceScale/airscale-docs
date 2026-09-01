# Airscale MCP AirSchool Experience Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the technical-first Mintlify MCP section with the four-page, task-first AirSchool experience while preserving verified contracts and machine-readable resources.

**Architecture:** The human-facing navigation becomes one four-page Getting started group. The existing tool catalog and agent-resource pages remain valid direct routes and machine-discovery targets, while the four visible MDX pages are rewritten to follow the current AirSchool narrative without copying stale facts or malformed headings.

**Tech Stack:** Mintlify MDX, docs.json navigation, Node.js built-in test runner, YAML frontmatter parsing, deterministic Node.js generators, Mint CLI, GitHub pull requests, Mintlify hosting.

**Operational MCP endpoint:** https://mcp.airscale.io/mcp

---

## File map

- Modify docs.json: declare the exact four-page visible MCP navigation.
- Modify tests/mcp-pages.test.mjs: define visible versus direct-only MCP routes and test the AirSchool page contract.
- Modify mcp/how-to-use-the-airscale-mcp.mdx: make the Claude-demo workflow the MCP entry page.
- Modify mcp/connect-airscale-mcp-to-chatgpt.mdx: use the current AirSchool setup progression with verified ChatGPT facts.
- Modify mcp/connect-airscale-mcp-to-claude.mdx: use the current AirSchool setup progression for Claude web, organizations, and Claude Code.
- Modify mcp/airscale-mcp-server.mdx: make the server overview the final concise reference page.
- Preserve mcp/tools.mdx: keep the generated 22-tool contract directly reachable.
- Preserve mcp/agent-resources.mdx: keep the advanced human and machine resource directory directly reachable.
- Modify scripts/build-agent-files.mjs: keep direct advanced resources discoverable after they leave sidebar navigation.
- Modify tests/mcp-generation.test.mjs: prove generated files reflect the four-page human path and advanced machine links.
- Regenerate llms.txt, llms-full.txt, and skill.md.

### Task 1: Lock the visible navigation contract

**Files:**
- Modify: tests/mcp-pages.test.mjs
- Modify: docs.json

- [ ] **Step 1: Replace the navigation fixture and write the failing assertions**

Use these fixtures near the top of tests/mcp-pages.test.mjs:

~~~js
const MCP_GROUPS = [
  {
    group: "Getting started",
    pages: [
      "mcp/how-to-use-the-airscale-mcp",
      "mcp/connect-airscale-mcp-to-chatgpt",
      "mcp/connect-airscale-mcp-to-claude",
      "mcp/airscale-mcp-server"
    ]
  }
];

const VISIBLE_MCP_PAGE_PATHS = MCP_GROUPS.flatMap(({ pages }) => pages);
const DIRECT_ONLY_MCP_PAGE_PATHS = ["mcp/tools", "mcp/agent-resources"];
const ALL_MCP_PAGE_PATHS = [...VISIBLE_MCP_PAGE_PATHS, ...DIRECT_ONLY_MCP_PAGE_PATHS];
~~~

Replace the current six-page navigation test with:

~~~js
test("MCP and Agents mirrors the four-page AirSchool getting-started flow", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  assert.equal(config.navigation.tabs.length, 2);
  assert.deepEqual(config.navigation.tabs[0], API_REFERENCE_TAB);
  assert.deepEqual(config.navigation.tabs[1], { tab: "MCP & Agents", groups: MCP_GROUPS });
  assert.deepEqual(VISIBLE_MCP_PAGE_PATHS, [
    "mcp/how-to-use-the-airscale-mcp",
    "mcp/connect-airscale-mcp-to-chatgpt",
    "mcp/connect-airscale-mcp-to-claude",
    "mcp/airscale-mcp-server"
  ]);

  const landing = readPage(VISIBLE_MCP_PAGE_PATHS[0]);
  assert.equal(landing.frontmatter.title, "How to use the Airscale MCP (+Claude demo)");
  assert.equal(landing.frontmatter.sidebarTitle, "How to use the Airscale MCP (+Claude demo)");

  for (const path of DIRECT_ONLY_MCP_PAGE_PATHS) {
    assert.ok(existsSync(path + ".mdx"), path + " must remain directly reachable");
    assert.equal(VISIBLE_MCP_PAGE_PATHS.includes(path), false);
  }

  assert.deepEqual(
    readdirSync("mcp")
      .filter((name) => name.endsWith(".mdx"))
      .map((name) => "mcp/" + name.slice(0, -4))
      .sort(),
    [...ALL_MCP_PAGE_PATHS].sort()
  );
});
~~~

Update metadata, credential, link-safety, and synthetic-example loops to iterate over ALL_MCP_PAGE_PATHS.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

~~~bash
node --test --test-name-pattern="AirSchool getting-started flow" tests/mcp-pages.test.mjs
~~~

Expected: FAIL because docs.json still declares Start, Connect, Use, and For agents groups and the current landing page is the server reference.

- [ ] **Step 3: Change docs.json to the exact four-page group**

Replace only the MCP & Agents tab groups with:

~~~json
"groups": [
  {
    "group": "Getting started",
    "pages": [
      "mcp/how-to-use-the-airscale-mcp",
      "mcp/connect-airscale-mcp-to-chatgpt",
      "mcp/connect-airscale-mcp-to-claude",
      "mcp/airscale-mcp-server"
    ]
  }
]
~~~

- [ ] **Step 4: Run the focused test**

Run the same test command. Expected: navigation assertions pass; landing-title assertions remain RED until Task 2.

- [ ] **Step 5: Commit the navigation contract**

~~~bash
git add docs.json tests/mcp-pages.test.mjs
git commit -m "test: define AirSchool MCP navigation"
~~~

### Task 2: Make the Claude demo workflow the entry page

**Files:**
- Modify: tests/mcp-pages.test.mjs
- Modify: mcp/how-to-use-the-airscale-mcp.mdx

- [ ] **Step 1: Add the failing opening-page contract**

Add:

~~~js
test("MCP entry page mirrors the AirSchool Claude-demo narrative", () => {
  const { body, frontmatter } = readPage("mcp/how-to-use-the-airscale-mcp");
  assert.deepEqual(frontmatter, {
    title: "How to use the Airscale MCP (+Claude demo)",
    sidebarTitle: "How to use the Airscale MCP (+Claude demo)",
    description: "Prospect through conversation with Airscale search, enrichment, and export tools.",
    canonical: "https://airscale.mintlify.app/mcp/how-to-use-the-airscale-mcp"
  });
  assert.match(body, /youtube\.com\/embed\/t4coJ0P8YVM/);
  assert.match(body, /className="w-full aspect-video rounded-xl"/);
  assert.match(body, /allowFullScreen/);
  assertOrdered(body, [
    "## What is the Airscale MCP?",
    "## How credits work",
    "## Run a search in natural language",
    "### Review your results",
    "### Enrich contacts through conversation",
    "## Export your final list",
    "## Get started"
  ], "mcp/how-to-use-the-airscale-mcp");
  assert.match(body, /22 typed tools/);
  assert.match(body, /Airsearch costs 2 credits per call/);
  assert.match(body, /0\.1 credit per returned (?:person|lead)/);
  assert.match(body, /0\.1 credit per returned company/);
  assert.match(body, /\[Connect Airscale MCP to ChatGPT\]\(\/mcp\/connect-airscale-mcp-to-chatgpt\)/);
  assert.match(body, /\[Connect Airscale MCP to Claude\]\(\/mcp\/connect-airscale-mcp-to-claude\)/);
  assert.doesNotMatch(body, /## Start the export|## Poll status|## Retrieve the file/);
});
~~~

- [ ] **Step 2: Run the test and verify RED**

~~~bash
node --test --test-name-pattern="Claude-demo narrative" tests/mcp-pages.test.mjs
~~~

Expected: FAIL on the old title and missing video.

- [ ] **Step 3: Replace the entry page**

Use this complete page:

~~~~mdx
---
title: "How to use the Airscale MCP (+Claude demo)"
sidebarTitle: "How to use the Airscale MCP (+Claude demo)"
description: "Prospect through conversation with Airscale search, enrichment, and export tools."
canonical: "https://airscale.mintlify.app/mcp/how-to-use-the-airscale-mcp"
---

Want to prospect without leaving your AI chat? Airscale MCP connects Claude, ChatGPT, and other compatible assistants directly to Airscale search, enrichment, research, and export tools.

<Frame>
<iframe
  className="w-full aspect-video rounded-xl"
  src="https://www.youtube.com/embed/t4coJ0P8YVM"
  title="How to prospect with Airscale MCP in Claude"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowFullScreen
></iframe>
</Frame>

## What is the Airscale MCP?

The Airscale MCP gives your AI assistant 22 typed tools for prospecting and research. Once connected, you can:

- Check the credits available in your Airscale workspace.
- Search for people and companies.
- Discover accepted Find Companies filter values.
- Enrich contacts with professional emails, phone numbers, personal emails, and public profile data.
- Run AI web research with Airsearch.
- Export people or companies to downloadable CSV or JSONL files.

For exact tool names, inputs, and result behavior, use the [MCP tool catalog](/mcp/tools).

## How credits work

Credit use through MCP follows the same rules as the corresponding Airscale API capability:

- Find People costs 0.1 credit per returned person.
- Find Companies costs 0.1 credit per returned company.
- Airsearch costs 2 credits per call.
- Other enrichment tools follow the pricing shown in their linked API reference.

Checking credits, counting people, and discovering company filter values are useful free planning steps. Paid export starts require explicit confirmation after you review the filters, row limit, and maximum possible spend.

## Run a search in natural language

After setup, describe the result you want and keep the first request small:

> Find up to five cybersecurity companies in France with 51 to 200 employees. Show me the proposed Airscale tool and maximum credit cost, then wait for approval.

Your assistant can translate that request into the appropriate Airscale tool call. Review the proposed filters before approving it.

### Review your results

Inspect the company names, domains, websites, countries, and filter precision before expanding the search. A five-result sample limits this Find Companies request to at most 0.5 credits and makes incorrect filters easy to spot.

### Enrich contacts through conversation

Continue with a bounded follow-up:

> Find the CEO, CFO, and Head of Growth for the approved companies. Show me the proposed paid action and wait for approval before running it.

You can then request the contact fields needed for outreach. Keep each paid step explicit so you can review the expected scope and credit behavior.

## Export your final list

For a downloadable result, ask the assistant to create one bounded export. Airscale starts an asynchronous job, returns an export identifier, reports progress through the status tool, and provides the file only after completion.

Keep polling the same export identifier and respect the returned polling interval. Do not start a duplicate job while the first export is queued or running.

## Get started

Choose your setup guide:

- [Connect Airscale MCP to ChatGPT](/mcp/connect-airscale-mcp-to-chatgpt)
- [Connect Airscale MCP to Claude](/mcp/connect-airscale-mcp-to-claude)
- [Review the Airscale MCP Server reference](/mcp/airscale-mcp-server)
~~~~

- [ ] **Step 4: Run focused MCP page tests**

~~~bash
node --test tests/mcp-pages.test.mjs
~~~

Expected: PASS for the opening-page contract and existing safety checks; any old developer-first landing assertions must be removed or rewritten for the new server page purpose.

- [ ] **Step 5: Commit**

~~~bash
git add mcp/how-to-use-the-airscale-mcp.mdx tests/mcp-pages.test.mjs
git commit -m "docs: lead MCP section with AirSchool workflow"
~~~

### Task 3: Rewrite the ChatGPT and Claude setup pages

**Files:**
- Modify: tests/mcp-pages.test.mjs
- Modify: mcp/connect-airscale-mcp-to-chatgpt.mdx
- Modify: mcp/connect-airscale-mcp-to-claude.mdx

- [ ] **Step 1: Replace the shared generic-heading test with distinct page contracts**

Add assertions that ChatGPT orders:

~~~js
[
  "## MCP server URL",
  "## What ChatGPT can do with Airscale MCP",
  "## Before you start",
  "## Step-by-step setup",
  "## Recommended first prompts",
  "## Export behavior in ChatGPT",
  "## Credits and confirmation",
  "## Refreshing tools",
  "## Troubleshooting",
  "## Security note",
  "## Need help?"
]
~~~

Add assertions that Claude orders:

~~~js
[
  "## MCP server URL",
  "## What Claude can do with Airscale MCP",
  "## Before you start",
  "## Claude web setup",
  "### Individual Claude accounts",
  "### Claude Team and Enterprise",
  "## Claude Code setup",
  "## Recommended first prompts",
  "## Export behavior",
  "## Credits and confirmation",
  "## Refreshing tools",
  "## Troubleshooting",
  "## Security note",
  "## Need help?"
]
~~~

Retain the existing assertions for browser OAuth, project-scoped Claude Code configuration, environment-only credentials, free credit check, 2-credit Airsearch, work-email-only managed enrichment, paid export confirmation, tool catalog links, and safe workflow links.

Add:

~~~js
assert.doesNotMatch(claude.body, /## ChatGPT setup/);
assert.equal((claude.body.match(/^## Claude Code setup$/gm) ?? []).length, 1);
assert.equal((chatgpt.body.match(/^## Step-by-step setup$/gm) ?? []).length, 1);
~~~

- [ ] **Step 2: Run the distinct guide tests and verify RED**

~~~bash
node --test --test-name-pattern="ChatGPT|Claude" tests/mcp-pages.test.mjs
~~~

Expected: FAIL on the new AirSchool heading order and the Claude-only scope.

- [ ] **Step 3: Rewrite the ChatGPT guide**

Keep its verified OAuth-only setup rules, but organize the page under the exact ChatGPT heading list above. Start with the official server URL, use a six-step Mintlify Steps component, keep the free first request, use short bounded prompt examples, and collapse troubleshooting into an AccordionGroup. Link the tool catalog instead of repeating individual schemas.

- [ ] **Step 4: Rewrite the Claude guide**

Organize the page under the exact Claude heading list above. Keep separate individual and organization web flows, then one project-scoped Claude Code section with the current environment-backed header configuration. Remove the duplicated ChatGPT setup from the Claude guide. Use the same free-first, bounded prompt, export, credit, and troubleshooting pattern as the ChatGPT guide.

- [ ] **Step 5: Run all MCP page tests**

~~~bash
node --test tests/mcp-pages.test.mjs
~~~

Expected: PASS with no unsafe credential, identity, domain, link, or credit assertions.

- [ ] **Step 6: Commit**

~~~bash
git add mcp/connect-airscale-mcp-to-chatgpt.mdx mcp/connect-airscale-mcp-to-claude.mdx tests/mcp-pages.test.mjs
git commit -m "docs: mirror AirSchool MCP connection guides"
~~~

### Task 4: Make the server page the final concise reference

**Files:**
- Modify: tests/mcp-pages.test.mjs
- Modify: mcp/airscale-mcp-server.mdx

- [ ] **Step 1: Write the failing server-reference contract**

Replace the old two-column hero tests with:

~~~js
test("server page is the final concise AirSchool reference", () => {
  const { body, frontmatter } = readPage("mcp/airscale-mcp-server");
  assert.deepEqual(frontmatter, {
    title: "Airscale MCP Server",
    description: "Connect Airscale to your AI assistant and prospect without leaving the chat.",
    canonical: "https://airscale.mintlify.app/mcp/airscale-mcp-server"
  });
  assertOrdered(body, [
    "## MCP server URL",
    "## Getting started",
    "## Setup walkthroughs",
    "## What you can do",
    "## Export lifecycle",
    "## How credits work",
    "## Recommended workflow",
    "## Security notes",
    "## Troubleshooting"
  ], "mcp/airscale-mcp-server");
  assert.match(body, /https:\/\/mcp\.airscale\.io\/mcp/);
  assert.match(body, /22 typed tools/);
  assert.match(body, /airscale_check_credits/);
  assert.match(body, /confirm_credit_spend/);
  assert.match(body, /Airsearch costs 2 credits per call/);
  assert.match(body, /\[MCP tool catalog\]\(\/mcp\/tools\)/);
  assert.doesNotMatch(body, /<Columns|### Configure your client/);
});
~~~

- [ ] **Step 2: Run and verify RED**

~~~bash
node --test --test-name-pattern="final concise AirSchool reference" tests/mcp-pages.test.mjs
~~~

Expected: FAIL on title, section order, and the old Columns hero.

- [ ] **Step 3: Rewrite mcp/airscale-mcp-server.mdx**

Use the tested frontmatter and headings. Keep the official endpoint and authentication boundary, link both setup guides, summarize search/enrichment/research/export capabilities, explain the single asynchronous export lifecycle, retain contract-backed credit rules, and keep security/troubleshooting concise. Do not duplicate the per-tool input tables.

- [ ] **Step 4: Run MCP page tests and commit**

~~~bash
node --test tests/mcp-pages.test.mjs
git add mcp/airscale-mcp-server.mdx tests/mcp-pages.test.mjs
git commit -m "docs: simplify Airscale MCP server reference"
~~~

Expected: all MCP page tests pass.

### Task 5: Regenerate and verify agent-facing resources

**Files:**
- Modify: scripts/build-agent-files.mjs
- Modify: tests/mcp-generation.test.mjs
- Regenerate: llms.txt
- Regenerate: llms-full.txt
- Regenerate: skill.md

- [ ] **Step 1: Add failing generation assertions**

In the agent-renderer test, assert:

~~~js
assert.match(rendered["llms.txt"], /MCP & Agents — Getting started/);
assert.match(rendered["llms.txt"], /How to use the Airscale MCP \(\+Claude demo\)/);
assert.doesNotMatch(rendered["llms.txt"], /MCP & Agents — Start|MCP & Agents — Connect|MCP & Agents — For agents/);
assert.match(rendered["llms.txt"], /\/mcp\/tools\.md/);
assert.match(rendered["llms.txt"], /\/mcp\/agent-resources\.md/);
assert.match(rendered["skill.md"], /\/mcp\/agent-resources/);
assert.doesNotMatch(Object.values(rendered).join("\n"), /\/mcp-tools\.txt/);
~~~

Assert llms-full.txt contains all 18 API pages plus the four visible MCP pages and omits the two direct-only advanced page bodies.

- [ ] **Step 2: Run and verify RED**

~~~bash
node --test --test-name-pattern="agent renderers publish" tests/mcp-generation.test.mjs
~~~

Expected: FAIL because llms.txt does not yet link the direct agent-resource Markdown page and generated files still reflect the old navigation.

- [ ] **Step 3: Add the direct agent-resource link**

In renderLlmsIndexModel, append this exact machine-contract line beside the OpenAPI, tool catalog, and skill links:

~~~js
"- [Agent resource directory](" + PREVIEW_ORIGIN + "/mcp/agent-resources.md): Human and machine entry points for Airscale agents and documentation consumers.",
~~~

Do not add direct-only pages to navigationEntries; llms-full.txt remains the full navigable corpus.

- [ ] **Step 4: Regenerate deterministic outputs**

~~~bash
npm run agents:build
~~~

Expected: llms.txt, llms-full.txt, and skill.md update atomically.

- [ ] **Step 5: Run generation and MCP tests**

~~~bash
node --test tests/mcp-generation.test.mjs tests/mcp-pages.test.mjs
npm run agents:check
~~~

Expected: PASS and exact-byte freshness.

- [ ] **Step 6: Commit**

~~~bash
git add scripts/build-agent-files.mjs tests/mcp-generation.test.mjs llms.txt llms-full.txt skill.md
git commit -m "docs: align agent resources with AirSchool MCP flow"
~~~

### Task 6: Full validation and visual QA

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run the complete repository gate**

~~~bash
npm run validate
~~~

Expected: OpenAPI, MCP catalog, agent generation, all Node tests, and Mint validation pass with exit code 0.

- [ ] **Step 2: Start the local Mintlify preview**

~~~bash
./node_modules/.bin/mint dev --no-open
~~~

Capture the URL printed by Mint. Keep this process in a dedicated terminal session.

- [ ] **Step 3: Browser QA at desktop width**

Open the four visible MCP routes. Verify:

- the sidebar shows one Getting started group in the exact approved order;
- the Claude-demo page is the tab landing page;
- the video frame is responsive and playable;
- headings and on-page table of contents follow the AirSchool narrative;
- ChatGPT and Claude setup controls and code blocks are readable;
- the server page no longer starts with a two-column technical hero;
- direct /mcp/tools and /mcp/agent-resources routes still render;
- browser console has no page errors;
- relevant document, video-thumbnail, and navigation requests do not fail.

- [ ] **Step 4: Browser QA at mobile width**

Repeat the opening page, both setup guides, and sidebar/drawer navigation at a mobile viewport. Verify no horizontal overflow, clipped video, hidden setup steps, or inaccessible navigation.

- [ ] **Step 5: Run final tests after any QA fixes**

~~~bash
npm run validate
git diff --check
git status --short
~~~

Expected: validation passes, diff check is clean, and only intended documentation changes remain.

### Task 7: Independent review, merge, deploy, and hosted proof

**Files:**
- Modify only to address review findings.

- [ ] **Step 1: Request independent code and content review**

Review the diff from origin/main to HEAD against the committed design and this plan. Fix every critical or important finding, then rerun npm run validate.

- [ ] **Step 2: Push and create a pull request**

~~~bash
git push -u origin docs/mcp-airschool-experience-replica
gh pr create --base main --head docs/mcp-airschool-experience-replica --title "docs: mirror AirSchool MCP experience" --body "## Summary
- mirror the four-page AirSchool MCP getting-started flow
- keep the generated tool catalog and agent resources directly available
- preserve noindex preview safety and machine-readable discovery

## Verification
- npm run validate
- desktop and mobile browser QA
- direct advanced-route checks"
~~~

The PR body must summarize the four-page navigation, task-first rewrite, preserved direct machine routes, full validation, and browser QA.

- [ ] **Step 3: Merge after terminal checks**

Run:

~~~bash
gh pr checks --watch --fail-fast
gh pr merge --merge
~~~

Record the feature head and resulting main merge SHA. Confirm the reviewed head is the merge commit's parent.

- [ ] **Step 4: Verify the exact Mintlify deployment**

Confirm the Mintlify Deployment check for the exact main merge SHA is completed with conclusion success. If the latest hosted content does not appear, use the Mintlify dashboard Manual update action once and record its terminal result.

- [ ] **Step 5: Verify hosted behavior three times**

For three consecutive rounds, verify:

- all four visible MCP routes return 200;
- /mcp/tools and /mcp/agent-resources return 200 directly;
- sidebar order and entry-page title are current;
- the video iframe uses t4coJ0P8YVM;
- llms.txt, page Markdown, and agent-skill discovery reflect the new flow;
- /mcp-tools.txt remains an expected 404 and is not advertised;
- all preview pages retain noindex and preview-host canonicals.

- [ ] **Step 6: Confirm untouched production boundaries**

Read-only checks must prove docs.airscale.io still points to the current Framer target and the operational MCP health and OAuth metadata endpoints remain healthy. Do not mutate DNS, Framer, Airscale application services, production data, or paid workloads.

- [ ] **Step 7: Completion audit**

Compare the hosted result requirement-by-requirement with the design specification. Mark the goal complete only when the visible replica, merge, exact deployment, machine resources, indexing safeguards, and untouched production boundaries all have direct evidence.
