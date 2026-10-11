# Updating the MCP contract

The public API reference, shared MCP client schemas, and this repository's MCP
snapshot are separate sources. Updating API prose does not update `tools/list`.

1. Update `packages/airscale-client/src` in `ViceScale/airscale-code` and test
   representative documented inputs with a mocked upstream. Preserve existing
   input forms and API alias precedence. Expose preset identifiers and formatting
   in tool descriptions; the Leads Finder tests here compare documented lists
   with the snapshot's descriptions.
2. Use the guarded MCP release workflow and retain its exact source SHA, Worker
   version and traffic receipt. A main merge alone is not release evidence.
3. Capture the released `tools/list` and update `contracts/mcp-tools.json`, its
   source SHA, and the independently pinned hashes/descriptions in
   `tests/mcp-contract.test.mjs`. Update the agent-file source pin in
   `scripts/build-agent-files.mjs` and `tests/mcp-generation.test.mjs`.
4. Generate and validate:

   ```sh
   npm run openapi:build
   npm run mcp:build
   npm run agents:build
   npm run validate
   npm run publication:check
   npm run mcp:check-live
   ```

`mcp:check-live` calls only `tools/list` with a synthetic invalid bearer. It does
not use a workspace credential, call a paid tool, or create an export. It fails
on missing/extra/duplicate tools, changed schemas or changed descriptions, and
reports the exact differing paths. It compares catalog content; use the release
receipt separately to establish deployment identity.

For an offline candidate captured from the local Worker handler:

```sh
node scripts/check-mcp-parity.mjs --catalog /tmp/candidate-tools.json
```

The **MCP catalog parity** GitHub workflow runs this check on relevant docs PRs
and supports manual dispatch. Release the MCP before opening the final catalog
refresh PR; a snapshot ahead of production is expected to fail live parity.
Publish the docs after those checks pass, then verify the served catalog and API
reference. Keep the canonical `airscale.mintlify.app` URLs used by this repo.
