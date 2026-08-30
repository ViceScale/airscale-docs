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
