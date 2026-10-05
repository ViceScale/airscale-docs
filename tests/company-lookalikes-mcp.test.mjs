import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { renderCatalog } from "../scripts/build-mcp-catalog.mjs";

const contract = JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));
const tool = contract.tools.find(({ name }) => name === "airscale_company_lookalikes");

test("MCP lookalikes maps to the existing synchronous paid company search operation", () => {
  assert.ok(tool, "tools/list must include company lookalikes");
  assert.equal(tool.category, "search_and_research");
  assert.equal(tool.operationId, "findCompanyLookalikes");
  assert.equal(tool.apiPage, "/api-reference/company-lookalikes");
  assert.equal(tool.asynchronous, false);
  assert.equal(tool.spend.kind, "variable");
  assert.match(tool.spend.summary, /0\.5 credits per unique returned company/);
  const operations = JSON.parse(readFileSync("contracts/public-api-operations.json", "utf8")).operations;
  assert.equal(operations.length, 30, "MCP reuses the existing API operation");
});

test("MCP lookalikes schema includes bounded references, total results, and strict filters", () => {
  assert.ok(tool);
  const schema = tool.inputSchema;
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(schema.properties.domains.minItems, 1);
  assert.equal(schema.properties.domains.maxItems, 10);
  assert.match(schema.properties.limit.description, /Defaults to 2000/);
  assert.equal(schema.properties.limit.maximum, 5000);
  assert.equal(validate({ domains: ["example.com"], limit: 1, include: { country: ["France"] }, exclude: { domains: ["excluded.example.com"] }, founded: { min: 2000, max: 2026 } }), true);
  for (const input of [{ domains: [] }, { domains: Array(11).fill("example.com") }, { domains: ["example.com"], limit: 5001 }, { domains: ["example.com"], workspaceId: "private" }, { domains: ["example.com"], include: { provider: "private" } }]) assert.equal(validate(input), false);
});

test("MCP lookalikes discovery uses a narrow example and retains credit, retry, and shared limits guidance", () => {
  const catalog = renderCatalog(contract);
  const block = catalog.split("### `airscale_company_lookalikes`")[1]?.split(/\n### `/)[0];
  assert.ok(block);
  assert.match(block, /"domains":\s*\[\s*"example.com"\s*\]/);
  assert.match(block, /"limit": 1\b/);
  assert.match(block, /0\.5 credits per unique returned company/);
  assert.match(block, /15 (?:starts|searches|requests) per rolling minute/);
  assert.match(block, /5 (?:active|concurrent) searches/);
  assert.match(block, /Do not automatically retry/);
  assert.doesNotMatch(block, /extruct|company[ _-]?enrich|idempotenc|KiB|MiB|settlement|request.body.limit/i);
  const skill = readFileSync("skill.md", "utf8");
  assert.match(skill, /airscale_company_lookalikes/);
  assert.match(skill, /Do not automatically retry/);
});
