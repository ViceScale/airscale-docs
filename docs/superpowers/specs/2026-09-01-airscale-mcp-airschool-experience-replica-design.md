# Airscale MCP AirSchool Experience Replica

## Goal

Replace the Mintlify MCP section's technical-first presentation with the task-first experience already used by the current AirSchool documentation at `https://docs.airscale.io/mcp/how-to-use-the-airscale-mcp`.

The result should feel like the existing AirSchool MCP section to a human reader while retaining the verified contracts, machine-readable resources, preview-indexing boundary, and deployment safeguards already implemented in the Mintlify repository.

## Source of truth

The current AirSchool MCP section defines the visible information architecture and editorial progression:

1. `How to use the Airscale MCP (+Claude demo)`
2. `Connect Airscale MCP to ChatGPT`
3. `Connect Airscale MCP to Claude`
4. `Airscale MCP Server`

The repository contracts remain the source of truth for operational facts such as tool names, input schemas, credit behavior, authentication boundaries, and asynchronous export behavior. The Framer copy must not override a newer verified contract merely to achieve a literal copy.

## Chosen approach

Replicate the AirSchool experience rather than duplicating every byte of its current prose.

- Match the four-page visible navigation, ordering, page purposes, narrative flow, and conversational tone.
- Reuse the existing Claude demonstration video, `https://youtu.be/t4coJ0P8YVM`, on the opening page.
- Preserve verified tool counts, pricing, OAuth behavior, spend approval requirements, and runtime endpoint details from the Mintlify contracts.
- Remove duplicate headings, dead next-page links, stale plan eligibility statements, and stale credit values found in the current Framer rendering.
- Keep advanced machine and contract resources published but outside the human-facing sidebar.

This intentionally rejects two alternatives:

- A literal copy would reproduce known stale or malformed details from the current Framer pages.
- A sidebar-only reorder would leave the technical-first content experience that the redesign is meant to replace.

## Visible navigation

The `MCP & Agents` tab will contain one group named `Getting started` with exactly these visible pages in this order:

1. `mcp/how-to-use-the-airscale-mcp`
2. `mcp/connect-airscale-mcp-to-chatgpt`
3. `mcp/connect-airscale-mcp-to-claude`
4. `mcp/airscale-mcp-server`

`mcp/tools` and `mcp/agent-resources` remain valid, directly accessible routes. They are removed only from visible sidebar navigation. They remain available to linked documentation, `llms.txt`, page-level Markdown exports, the agent skill, and integrity checks.

No API Reference navigation, API operation page, DNS record, Framer page, or production Airscale application surface changes as part of this work.

## Page designs

### How to use the Airscale MCP (+Claude demo)

This becomes the entry page and follows the current AirSchool progression:

1. Short promise: prospect through an AI conversation without switching products.
2. Embedded Claude demonstration video.
3. What the MCP is and what it can do.
4. How credits work, with current contract-backed values.
5. A natural-language company-search example.
6. Review returned results.
7. Continue the workflow by enriching contacts conversationally.
8. Export the final list.
9. Links to the ChatGPT and Claude setup pages.

Examples stay illustrative. Any example that could spend credits must state its bounded scope or require review before execution.

### Connect Airscale MCP to ChatGPT

Keep the current AirSchool page's onboarding sequence while removing unrelated reference depth:

1. Official remote MCP server URL.
2. What ChatGPT can do with Airscale.
3. Prerequisites and current product-availability caveat.
4. Step-by-step custom app and OAuth setup.
5. Free first test using the credit check.
6. Recommended prompts.
7. Short export, credit, refresh, troubleshooting, and security guidance.

The page links to the contract-backed tool catalog for readers who need exact schemas.

### Connect Airscale MCP to Claude

Mirror the current AirSchool setup-focused flow:

1. Official remote MCP server URL.
2. Individual Claude web connector setup.
3. Team and Enterprise organization setup.
4. Claude Code header-based setup using an environment placeholder rather than a literal credential.
5. Free first test using the credit check.
6. Recommended prompts.
7. Short export, credit, refresh, troubleshooting, and security guidance.

The page covers Claude only. It does not repeat the ChatGPT setup inside the Claude guide.

### Airscale MCP Server

This becomes the final reference page rather than the entry page:

1. Official server URL and authentication choices.
2. Setup walkthrough links.
3. Concise capability overview.
4. Export lifecycle and metadata.
5. Contract-backed credit summary.
6. Recommended workflow.
7. Security and troubleshooting.

Long per-tool schemas remain in the directly accessible tool catalog instead of being duplicated here.

## Machine readability and indexing

The preview remains `noindex, follow` with preview-host canonical URLs. The redesign must not change DNS or imply that `docs.airscale.io` has moved.

Machine-readable support remains available through:

- `openapi.json`
- `mcp/tools.md`
- `llms.txt`
- `llms-full.txt`
- page-level `.md` exports
- `skill.md`
- `/.well-known/agent-skills/index.json`
- `/.well-known/agent-skills/airscale/skill.md`

Generated files must describe the four-page human path while retaining discoverability of the advanced tool catalog and agent resources. The obsolete hosted `/mcp-tools.txt` path must not be reintroduced.

## Verification requirements

Implementation begins with regression tests that fail against the current six-page sidebar and technical-first opening page. The tests must prove:

- The MCP tab has one `Getting started` group with the exact four visible pages and order above.
- The opening page title and sidebar title match `How to use the Airscale MCP (+Claude demo)`.
- The opening page embeds the approved YouTube demonstration.
- The four visible pages retain their distinct onboarding purposes.
- `mcp/tools.mdx` and `mcp/agent-resources.mdx` still exist and remain reachable directly.
- The tool count and credit details come from current repository contracts.
- Generated LLM and skill resources contain the new human path and do not advertise `/mcp-tools.txt`.
- Preview `noindex` and canonical safeguards remain intact.

Before merge:

1. Run focused MCP/navigation tests.
2. Run `npm run validate` from the documentation repository.
3. Render the changed pages locally or through the branch preview.
4. Compare desktop and mobile views with the current AirSchool pages.
5. Inspect the browser console, page navigation, embedded video, and relevant network requests.
6. Obtain an independent code and content review and address critical or important findings.

## Merge and deployment

Publish through a pull request from an isolated documentation branch. Merge only after fresh full validation and review.

Deployment proof requires:

- exact merged `origin/main` SHA;
- terminal Mintlify deployment check for that SHA;
- successful hosted responses for the four visible MCP pages and two direct advanced routes;
- correct visible sidebar order and opening-page content in the browser;
- current machine-readable resources and agent-skill discovery;
- repeated hosted checks after the deployment settles;
- an explicit statement that `docs.airscale.io` DNS and the Framer site were not changed.

If Mintlify or Vercel serves a previously warmed immutable-looking file, report that cache state separately from the new page deployment and verify the current content through the supported discovery or cache-busted route.
