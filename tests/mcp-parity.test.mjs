import assert from "node:assert/strict";
import test from "node:test";
import { compareMcpCatalog, fetchLiveCatalog } from "../scripts/check-mcp-parity.mjs";

const tool = { name: "airscale_example", description: "Example", inputSchema: { type: "object", properties: { q: { type: "string" } } } };
const snapshot = { sourceSha: "a".repeat(40), tools: [tool] };

test("ignores object key order and docs-only metadata", () => {
  const reordered = { inputSchema: { properties: { q: { type: "string" } }, type: "object" }, description: "Example", name: tool.name };
  assert.deepEqual(compareMcpCatalog(snapshot, { result: { tools: [reordered] } }), []);
});

test("reports actionable schema and description differences", () => {
  const changed = structuredClone(tool);
  changed.inputSchema.properties.q.type = "number";
  changed.description = "Changed";
  const issues = compareMcpCatalog(snapshot, { tools: [changed] });
  assert.ok(issues.some(issue => issue.includes("airscale_example.inputSchema.properties.q.type")));
  assert.ok(issues.some(issue => issue.includes("airscale_example.description")));
});

test("detects missing, extra and duplicate tools in either catalog", () => {
  assert.match(compareMcpCatalog(snapshot, { tools: [] }).join("\n"), /missing.*airscale_example/i);
  assert.match(compareMcpCatalog({ tools: [] }, snapshot).join("\n"), /undocumented.*airscale_example/i);
  assert.match(compareMcpCatalog(snapshot, { tools: [tool, tool] }).join("\n"), /duplicate/i);
  assert.match(compareMcpCatalog({ tools: [tool, tool] }, snapshot).join("\n"), /duplicate/i);
});

test("fails closed for errors and malformed catalogs", () => {
  for (const bad of [{ error: { message: "failed" } }, { tools: [{}] }, { tools: [{ name: "x" }] }, null]) {
    assert.throws(() => compareMcpCatalog(snapshot, bad), /catalog|tool/i);
  }
});

test("live probe only lists tools with a synthetic invalid bearer", async () => {
  const calls = [];
  const result = await fetchLiveCatalog(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ result: { tools: [tool] } }), { status: 200 });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://mcp.airscale.io/mcp");
  assert.equal(JSON.parse(calls[0].init.body).method, "tools/list");
  assert.match(calls[0].init.headers.Authorization, /invalid/);
  assert.deepEqual(compareMcpCatalog(snapshot, result), []);
  await assert.rejects(fetchLiveCatalog(async () => new Response("unavailable", { status: 503 })), /503/);
});
