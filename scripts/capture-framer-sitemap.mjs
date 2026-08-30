import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE_URL = "https://docs.airscale.io/sitemap.xml";
const OUTPUT_PATH = "inventory/framer-routes.json";

const approvedApiPaths = new Set([
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

const consolidations = new Map([
  ["/api-reference/connect-airscale-mcp-to-chatgpt", "/mcp/connect-airscale-mcp-to-chatgpt"],
  ["/api-reference/connect-airscale-mcp-to-claude", "/mcp/connect-airscale-mcp-to-claude"],
  ["/api-reference/airscale-mcp-server", "/mcp/airscale-mcp-server"]
]);

const omissions = new Map([
  ["/api-reference/dnc-checker", "No approved public operation exists in the locked API contract manifest."],
  ["/api-reference/leads-finder", "The retired Leads Finder API page is excluded from the approved public reference."]
]);

function categoryFor(path) {
  if (path === "/") return "home";
  if (path.startsWith("/usecases/")) return "use-case";
  if (path.startsWith("/api-reference/")) return "api-reference";
  if (path.startsWith("/mcp/")) return "mcp";
  if (path.startsWith("/docs/")) return "product-guide";
  throw new Error(`Unclassified Framer path: ${path}`);
}

function classify(path) {
  const category = categoryFor(path);
  if (path === "/") {
    return {
      path,
      category,
      disposition: "rewrite",
      targetPath: path,
      reason: "Replace the preview homepage with the approved balanced two-path gateway."
    };
  }
  if (approvedApiPaths.has(path)) {
    return {
      path,
      category,
      disposition: "rewrite",
      targetPath: path,
      reason: "Convert the approved public API page to the OpenAPI-plus-MDX reference model."
    };
  }
  if (consolidations.has(path)) {
    return {
      path,
      category,
      disposition: "consolidate",
      targetPath: consolidations.get(path),
      reason: "Use the canonical MCP guide in the preview navigation instead of duplicate API-reference content."
    };
  }
  if (omissions.has(path)) {
    return {
      path,
      category,
      disposition: "omit",
      targetPath: null,
      reason: omissions.get(path)
    };
  }
  if (category === "use-case" || category === "mcp" || category === "product-guide") {
    return {
      path,
      category,
      disposition: "migrate",
      targetPath: path,
      reason: "Preserve this public product-learning route on the separate preview host."
    };
  }
  throw new Error(`No disposition for Framer path: ${path}`);
}

function parsePaths(xml) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
  for (const url of urls) assert.equal(url.origin, "https://docs.airscale.io");
  return urls.map(({ pathname }) => pathname).map((path) => path || "/");
}

async function livePaths() {
  const response = await fetch(SOURCE_URL, { headers: { accept: "application/xml" } });
  if (!response.ok) throw new Error(`Sitemap request failed with ${response.status}`);
  const paths = parsePaths(await response.text());
  assert.equal(paths.length, 82, "Framer sitemap route count changed; inspect before refreshing inventory");
  assert.equal(new Set(paths).size, paths.length, "Framer sitemap contains duplicate paths");
  return paths;
}

const mode = process.argv[2];
const paths = await livePaths();

if (mode === "--write") {
  const inventory = {
    sourceUrl: SOURCE_URL,
    capturedAt: new Date().toISOString(),
    routes: paths.map(classify)
  };
  mkdirSync("inventory", { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Captured and classified ${inventory.routes.length} Framer routes.`);
} else if (mode === "--check") {
  const inventory = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  assert.deepEqual(
    paths,
    inventory.routes.map(({ path }) => path),
    "Live Framer sitemap differs from the committed inventory"
  );
  console.log(`Framer sitemap matches inventory (${paths.length} routes).`);
} else {
  throw new Error("Use --write to refresh inventory or --check to compare without writing.");
}
