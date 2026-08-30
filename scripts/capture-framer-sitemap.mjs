import assert from "node:assert/strict";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";

export const SOURCE_URL = "https://docs.airscale.io/sitemap.xml";
export const OUTPUT_PATH = "inventory/framer-routes.json";
export const EXPECTED_ROUTE_COUNT = 82;
export const REQUEST_TIMEOUT_MS = 10_000;

const EXPECTED_COUNTS = { migrate: 60, rewrite: 17, consolidate: 3, omit: 2 };

const publicApiContract = JSON.parse(
  readFileSync(new URL("../contracts/public-api-contracts.json", import.meta.url), "utf8")
);

export const approvedApiPaths = new Set(
  Object.keys(publicApiContract.pages).map((page) => `/api-reference/${page}`)
);

export const consolidations = new Map([
  ["/api-reference/connect-airscale-mcp-to-chatgpt", "/mcp/connect-airscale-mcp-to-chatgpt"],
  ["/api-reference/connect-airscale-mcp-to-claude", "/mcp/connect-airscale-mcp-to-claude"],
  ["/api-reference/airscale-mcp-server", "/mcp/airscale-mcp-server"]
]);

export const omissions = new Map([
  ["/api-reference/dnc-checker", "No approved public operation exists in the locked API contract manifest."],
  ["/api-reference/leads-finder", "The retired Leads Finder API page is excluded from the approved public reference."]
]);

function localName(node) {
  return node.localName || node.nodeName.split(":").at(-1);
}

function childElements(node) {
  return Array.from(node.childNodes || []).filter(({ nodeType }) => nodeType === 1);
}

export function categoryFor(path) {
  if (path === "/") return "home";
  if (path.startsWith("/usecases/")) return "use-case";
  if (path.startsWith("/api-reference/")) return "api-reference";
  if (path.startsWith("/mcp/")) return "mcp";
  if (path.startsWith("/docs/")) return "product-guide";
  throw new Error(`Unclassified Framer path: ${path}`);
}

export function classify(path) {
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

export function parsePaths(xml) {
  let parseError;
  const parser = new DOMParser({
    onError(_level, message) { parseError ??= message; }
  });
  const document = parser.parseFromString(xml, "application/xml");
  if (parseError) throw new Error(`Malformed XML: ${parseError}`);

  const root = document?.documentElement;
  if (!root || localName(root) !== "urlset") throw new Error("Malformed XML: sitemap root must be urlset");
  const urls = childElements(root).filter((element) => localName(element) === "url");
  if (urls.length === 0) throw new Error("Malformed XML: sitemap contains no url elements");

  return urls.map((urlElement) => {
    const locs = childElements(urlElement).filter((element) => localName(element) === "loc");
    if (locs.length !== 1) throw new Error(`Each url must contain exactly one loc (found ${locs.length})`);
    const rawLocation = locs[0].textContent.trim();
    let url;
    try {
      url = new URL(rawLocation);
    } catch (error) {
      throw new Error(`Invalid sitemap loc ${JSON.stringify(rawLocation)}: ${error.message}`, { cause: error });
    }
    assert.equal(url.origin, "https://docs.airscale.io");
    return url.pathname || "/";
  });
}

export function normalizePaths(paths) {
  assert.ok(Array.isArray(paths), "Sitemap paths must be an array");
  const sorted = paths.map((path) => {
    assert.equal(typeof path, "string", "Sitemap paths must be strings");
    assert.match(path, /^\//, `Invalid sitemap path: ${path}`);
    return path;
  }).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  assert.equal(new Set(sorted).size, sorted.length, "Framer sitemap contains duplicate paths");
  return sorted;
}

export function buildInventory(paths, { capturedAt = new Date().toISOString() } = {}) {
  return {
    sourceUrl: SOURCE_URL,
    capturedAt,
    routes: normalizePaths(paths).map(classify)
  };
}

export function validateInventory(inventory, { requireComplete = true } = {}) {
  assert.equal(inventory?.sourceUrl, SOURCE_URL);
  assert.match(inventory?.capturedAt ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Array.isArray(inventory.routes), "Inventory routes must be an array");
  if (requireComplete) assert.equal(inventory.routes.length, EXPECTED_ROUTE_COUNT);
  const paths = normalizePaths(inventory.routes.map(({ path }) => path));
  assert.deepEqual(inventory.routes.map(({ path }) => path), paths, "Inventory routes must be sorted");
  assert.deepEqual(inventory.routes, paths.map(classify), "Inventory route classification does not match policy");

  const counts = Object.fromEntries(Object.keys(EXPECTED_COUNTS).map((key) => [key, 0]));
  for (const route of inventory.routes) counts[route.disposition] += 1;
  if (requireComplete) assert.deepEqual(counts, EXPECTED_COUNTS);
  return true;
}

export function compareInventory(inventory, paths) {
  validateInventory(inventory, { requireComplete: false });
  assert.deepEqual(inventory.routes, normalizePaths(paths).map(classify), "Live Framer sitemap route objects differ from the committed inventory");
  return true;
}

export function createRequestOptions() {
  return {
    method: "GET",
    headers: { accept: "application/xml" },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };
}

export async function fetchSitemap(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(SOURCE_URL, createRequestOptions());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const paths = normalizePaths(parsePaths(await response.text()));
    assert.equal(paths.length, EXPECTED_ROUTE_COUNT, "Framer sitemap route count changed; inspect before refreshing inventory");
    return paths;
  } catch (error) {
    throw new Error(`Sitemap request failed for ${SOURCE_URL}: ${error.message}`, { cause: error });
  }
}

const defaultFileIO = { mkdirSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync };

export function writeInventoryAtomic(inventory, { outputPath = OUTPUT_PATH, fsImpl = {} } = {}) {
  const io = { ...defaultFileIO, ...fsImpl };
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  io.mkdirSync(dirname(outputPath), { recursive: true });
  let descriptor;
  try {
    io.writeFileSync(temporaryPath, `${JSON.stringify(inventory, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    descriptor = io.openSync(temporaryPath, "r+");
    io.fsyncSync(descriptor);
    io.closeSync(descriptor);
    descriptor = undefined;
    io.renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (descriptor !== undefined) {
      try { io.closeSync(descriptor); } catch {}
    }
    try { io.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

export function parseCliArgs(args) {
  if (!Array.isArray(args) || args.length !== 1 || (args[0] !== "--write" && args[0] !== "--check")) {
    throw new Error("Use --write to refresh inventory or --check to compare without writing (exactly one argument required).");
  }
  return args[0];
}

export async function run(args, {
  fetchImpl = fetch,
  readFileImpl = readFileSync,
  writeInventoryImpl = writeInventoryAtomic
} = {}) {
  const mode = parseCliArgs(args);
  const paths = await fetchSitemap(fetchImpl);
  if (mode === "--write") {
    const inventory = buildInventory(paths);
    validateInventory(inventory);
    writeInventoryImpl(inventory, { outputPath: OUTPUT_PATH });
    console.log(`Captured and classified ${inventory.routes.length} Framer routes.`);
    return inventory;
  }
  const inventory = JSON.parse(readFileImpl(OUTPUT_PATH, "utf8"));
  compareInventory(inventory, paths);
  console.log(`Framer sitemap matches inventory (${paths.length} routes).`);
  return inventory;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}
