import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function toolMap(catalog, label, issues) {
  const tools = catalog?.result?.tools ?? catalog?.tools;
  if (!Array.isArray(tools) || catalog?.error) throw new Error(`${label}: malformed tool catalog`);
  const map = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== "string" || !tool.name || typeof tool.description !== "string"
      || !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
      throw new Error(`${label}: malformed tool entry`);
    }
    if (map.has(tool.name)) issues.push(`${label}: duplicate tool ${tool.name}`);
    map.set(tool.name, tool);
  }
  return map;
}

function differences(expected, actual, path, issues) {
  if (Object.is(expected, actual)) return;
  if (expected && actual && typeof expected === "object" && typeof actual === "object"
    && Array.isArray(expected) === Array.isArray(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      differences(expected[key], actual[key], `${path}.${key}`, issues);
    }
    return;
  }
  issues.push(`${path}: docs=${JSON.stringify(expected) ?? "absent"}; catalog=${JSON.stringify(actual) ?? "absent"}`);
}

export function compareMcpCatalog(contract, catalog) {
  const issues = [];
  const expected = toolMap(contract, "docs", issues);
  const actual = toolMap(catalog, "catalog", issues);
  for (const [name, tool] of expected) {
    const current = actual.get(name);
    if (!current) { issues.push(`catalog: missing tool ${name}`); continue; }
    differences(tool.description, current.description, `${name}.description`, issues);
    differences(tool.inputSchema, current.inputSchema, `${name}.inputSchema`, issues);
  }
  for (const name of actual.keys()) if (!expected.has(name)) issues.push(`catalog: undocumented tool ${name}`);
  return issues;
}

export async function fetchLiveCatalog(fetchImpl = fetch) {
  const response = await fetchImpl("https://mcp.airscale.io/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer airscale-docs-parity-invalid-key",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`MCP tools/list returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.length === 1 && args[0] === "--live";
  const offline = args.length === 2 && args[0] === "--catalog";
  if (!live && !offline) throw new Error("Usage: node scripts/check-mcp-parity.mjs --live | --catalog <tools-list.json>");
  const contract = JSON.parse(readFileSync(fileURLToPath(new URL("../contracts/mcp-tools.json", import.meta.url)), "utf8"));
  const catalog = live ? await fetchLiveCatalog() : JSON.parse(readFileSync(resolve(args[1]), "utf8"));
  const issues = compareMcpCatalog(contract, catalog);
  if (issues.length) {
    console.error(`MCP catalog drift (${issues.length} differences; docs source ${contract.sourceSha}):`);
    for (const issue of issues.slice(0, 40)) console.error(`- ${issue}`);
    if (issues.length > 40) console.error(`- ${issues.length - 40} additional differences`);
    process.exitCode = 1;
    return;
  }
  console.log(`MCP catalog parity passed: ${contract.tools.length} tools; docs source ${contract.sourceSha}. Deployment identity requires the release receipt.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
