---
name: airscale
description: Search for people and companies, enrich professional contact data, run web research, and create asynchronous exports through the Airscale API or MCP server.
metadata:
  version: "1.0"
  source_sha: "b06ea2c46276f8415a97721f6901437ce07f13fa"
---

# Airscale

Use Airscale to search for people and companies, enrich professional contact data, research the web, and create asynchronous exports. Start with free checks, keep paid samples narrow, and never execute a paid export without the user's explicit approval.

## Choose the correct interface

- Use the HTTP API when application code needs direct request and response control. Start at https://airscale.mintlify.app/api-reference/api-overview.
- Use the authenticated Airscale MCP product server at https://mcp.airscale.io/mcp when an MCP client should call Airscale tools. Some tools spend workspace credits.
- Use the documentation-scoped MCP at https://airscale.mintlify.app/mcp only for documentation. Its search and filesystem tools are read-only; submit_feedback can send documentation feedback. It does not execute Airscale product tools or consume Airscale credits.

## Authentication boundaries

### API authentication

Send the workspace API key as a Bearer token in the HTTP Authorization header. Keep the key in a server-side environment variable or secret manager; never place it in a URL, client-side bundle, prompt, or log.

### MCP authentication

Prefer browser OAuth in supported remote MCP clients. Header-capable local clients may read the Airscale API key from an environment variable and send it as the Authorization header. Never include an API key in MCP tool arguments.

## Free-first workflow

1. Verify authentication with airscale_check_credits, which is free.
2. Use airscale_count_find_people or airscale_find_companies_filter_values before a paid search when those tools fit the task.
3. Run a narrow synthetic or user-approved sample and review the result shape.
4. Refine filters and calculate the maximum additional spend.
5. Ask for explicit user confirmation before starting a paid export.
6. While an asynchronous export is queued or running, poll using the server-provided poll_after_seconds value. Stop polling when it completes or fails, and retrieve the file only after completion.

## Credit and approval rules

- Airsearch costs 2 credits per call.
- Search and enrichment tools can consume credits according to their documented result-based pricing.
- Paid export start tools require confirm_credit_spend. Set confirm_credit_spend to true only after explicit user confirmation of the bounded request and maximum spend.
- Checking credits, counting people, discovering company filter values, polling export status, and retrieving a completed export file do not themselves start paid export work.

## Authoritative resources

- MCP workflow and safety: https://airscale.mintlify.app/mcp/how-to-use-the-airscale-mcp
- MCP tool catalog (Markdown): https://airscale.mintlify.app/mcp/tools.md
- HTTP API reference: https://airscale.mintlify.app/api-reference/api-overview
- OpenAPI specification: https://airscale.mintlify.app/openapi.json
- Agent resource directory: https://airscale.mintlify.app/mcp/agent-resources

For the documentation MCP filesystem, run tree / -L 2 before reading files. Actual paths include /api-reference/api-overview.mdx and /mcp/airscale-mcp-server.mdx; generic example paths shown by a client may not exist. If an MCP-rendered API page shows repeated or conflicting request fields, trust the endpoint prose or https://airscale.mintlify.app/openapi.json.
