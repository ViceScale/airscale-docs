import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REQUEST_TIMEOUT_MS,
  SOURCE_URL,
  buildInventory,
  compareInventory,
  createRequestOptions,
  normalizePaths,
  parsePaths,
  run,
  validateInventory,
  writeInventoryAtomic
} from "../scripts/capture-framer-sitemap.mjs";

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

const expectedApiRoutes = new Set([
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

function expectedShape(path) {
  if (path === "/") return { path, category: "home", disposition: "rewrite", targetPath: path };
  if (expectedApiRoutes.has(path)) return { path, category: "api-reference", disposition: "rewrite", targetPath: path };
  if (expectedConsolidations.has(path)) return { path, category: "api-reference", disposition: "consolidate", targetPath: expectedConsolidations.get(path) };
  if (expectedOmissions.has(path)) return { path, category: "api-reference", disposition: "omit", targetPath: null };
  if (path.startsWith("/usecases/")) return { path, category: "use-case", disposition: "migrate", targetPath: path };
  if (path.startsWith("/mcp/")) return { path, category: "mcp", disposition: "migrate", targetPath: path };
  if (path.startsWith("/docs/")) return { path, category: "product-guide", disposition: "migrate", targetPath: path };
  throw new Error(`Unexpected test route: ${path}`);
}

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

test("every route matches its exact approved category, disposition, and target", () => {
  assert.deepEqual(
    inventory.routes.map(({ path, category, disposition, targetPath }) => ({ path, category, disposition, targetPath })),
    inventory.routes.map(({ path }) => expectedShape(path))
  );
});

test("route mutations fail both inventory validation and live check comparison", () => {
  const swapped = structuredClone(inventory);
  const migrateIndex = swapped.routes.findIndex(({ disposition }) => disposition === "migrate");
  [swapped.routes[0].disposition, swapped.routes[migrateIndex].disposition] = [
    swapped.routes[migrateIndex].disposition,
    swapped.routes[0].disposition
  ];
  [swapped.routes[0].targetPath, swapped.routes[migrateIndex].targetPath] = [
    swapped.routes[migrateIndex].targetPath,
    swapped.routes[0].targetPath
  ];

  assert.throws(() => validateInventory(swapped), /route classification|rewrite|migrate/i);
  assert.throws(() => compareInventory(swapped, inventory.routes.map(({ path }) => path)), /route classification|rewrite|migrate/i);

  const reasonMutated = structuredClone(inventory);
  reasonMutated.routes[0].reason = "tampered";
  assert.throws(() => compareInventory(reasonMutated, inventory.routes.map(({ path }) => path)), /route classification|route objects/i);
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

test("XML parsing decodes entities and accepts namespace-prefixed sitemap elements", () => {
  const xml = `<?xml version="1.0"?><sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://docs.airscale.io/docs/a&amp;b&#x2F;c</sm:loc></sm:url></sm:urlset>`;
  assert.deepEqual(parsePaths(xml), ["/docs/a&b/c"]);
});

test("XML parsing rejects malformed XML and missing or multiple loc values", () => {
  assert.throws(() => parsePaths(`<urlset><url><loc>${SOURCE_URL}/docs/a</loc>`), /malformed|parse/i);
  assert.throws(() => parsePaths(`<urlset><url /></urlset>`), /exactly one loc/i);
  assert.throws(() => parsePaths(`<urlset><url><loc>${SOURCE_URL}/docs/a</loc><loc>${SOURCE_URL}/docs/b</loc></url></urlset>`), /exactly one loc/i);
});

test("normalization sorts route fixtures before classification and comparison", () => {
  const first = ["/docs/z", "/", "/docs/a"];
  const second = ["/docs/a", "/docs/z", "/"];
  assert.deepEqual(normalizePaths(first), ["/", "/docs/a", "/docs/z"]);
  assert.deepEqual(buildInventory(first, { capturedAt: "2026-01-01T00:00:00.000Z" }).routes, buildInventory(second, { capturedAt: "2026-01-01T00:00:00.000Z" }).routes);
  assert.doesNotThrow(() => compareInventory(buildInventory(first), second));
});

test("atomic inventory writes leave only the final file and clean temp files on failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "airscale-inventory-"));
  const outputPath = join(directory, "framer-routes.json");
  const sample = buildInventory(["/"], { capturedAt: "2026-01-01T00:00:00.000Z" });

  writeInventoryAtomic(sample, { outputPath });
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), sample);
  assert.deepEqual(readdirSync(directory), ["framer-routes.json"]);

  const failurePath = join(directory, "failure.json");
  assert.throws(
    () => writeInventoryAtomic(sample, {
      outputPath: failurePath,
      fsImpl: { renameSync() { throw new Error("injected rename failure"); } }
    }),
    /injected rename failure/
  );
  assert.equal(existsSync(failurePath), false);
  assert.deepEqual(readdirSync(directory), ["framer-routes.json"]);

  const existingPath = join(directory, "existing.json");
  writeInventoryAtomic(sample, { outputPath: existingPath });
  const existingContents = readFileSync(existingPath, "utf8");
  assert.throws(
    () => writeInventoryAtomic(buildInventory(["/docs/a"], { capturedAt: "2026-01-01T00:00:00.000Z" }), {
      outputPath: existingPath,
      fsImpl: { renameSync() { throw new Error("injected replacement failure"); } }
    }),
    /injected replacement failure/
  );
  assert.equal(readFileSync(existingPath, "utf8"), existingContents);
  assert.deepEqual(readdirSync(directory).sort(), ["existing.json", "framer-routes.json"]);
});

test("invalid CLI mode is rejected before fetch and sitemap requests are bounded GETs", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    run("--invalid", { fetchImpl: async () => { fetchCalls += 1; } }),
    /Use --write to refresh inventory or --check to compare without writing/
  );
  assert.equal(fetchCalls, 0);

  const options = createRequestOptions();
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  assert.equal(options.body, undefined);
  assert.equal(options.headers.accept, "application/xml");
  assert.equal(REQUEST_TIMEOUT_MS, 10_000);
  assert.ok(options.signal instanceof AbortSignal);
});

test("sitemap request errors identify the source URL", async () => {
  await assert.rejects(
    run("--check", {
      fetchImpl: async () => { throw new Error("network down"); },
      readFileImpl: () => readFileSync("inventory/framer-routes.json", "utf8")
    }),
    new RegExp(SOURCE_URL.replaceAll(".", "\\."))
  );
});
