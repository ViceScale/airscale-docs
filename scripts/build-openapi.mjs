import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { baseSpec } from "../openapi/base.mjs";
import { accountOperations } from "../openapi/operations/account.mjs";
import { contactDataOperations } from "../openapi/operations/contact-data.mjs";
import { profileLookupOperations } from "../openapi/operations/profile-lookup.mjs";
import { searchDiscoveryOperations } from "../openapi/operations/search-discovery.mjs";

const defaultCatalog = JSON.parse(readFileSync(new URL("../contracts/public-api-operations.json", import.meta.url), "utf8"));
const defaultOperationModules = [
  accountOperations,
  contactDataOperations,
  profileLookupOperations,
  searchDiscoveryOperations
];
const outputPath = new URL("../openapi.json", import.meta.url);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entryKey(entry) {
  return `${entry.method.toUpperCase()} ${entry.path}`;
}

function validateUnique(entries, label, value) {
  const seen = new Set();
  for (const entry of entries) {
    const current = value(entry);
    if (seen.has(current)) throw new Error(`Duplicate OpenAPI ${label}: ${current}`);
    seen.add(current);
  }
}

function validateOperationEntries(catalog, operationModules) {
  const catalogOperations = catalog.operations;
  const moduleOperations = operationModules.flat();

  validateUnique(catalogOperations, "catalog method/path", entryKey);
  validateUnique(catalogOperations, "catalog operationId", (entry) => entry.operationId);
  validateUnique(moduleOperations, "method/path", entryKey);
  validateUnique(moduleOperations, "operationId", (entry) => entry.operation.operationId);

  const catalogKeys = new Set(catalogOperations.map(entryKey));
  for (const entry of moduleOperations) {
    if (!catalogKeys.has(entryKey(entry))) {
      throw new Error(`Extra OpenAPI operation module entry: ${entryKey(entry)}`);
    }
  }

  return moduleOperations;
}

export function buildSpec({ catalog, operationModules, base } = {}) {
  const resolvedCatalog = catalog ?? defaultCatalog;
  const resolvedOperationModules = operationModules ?? defaultOperationModules;
  const resolvedBase = base ?? baseSpec;
  const moduleOperations = validateOperationEntries(resolvedCatalog, resolvedOperationModules);
  const spec = clone(resolvedBase);
  const byKey = new Map(moduleOperations.map((entry) => [entryKey(entry), entry]));

  for (const expected of resolvedCatalog.operations) {
    const key = entryKey(expected);
    const entry = byKey.get(key);
    if (!entry) throw new Error(`Missing OpenAPI operation module entry: ${key}`);
    if (entry.operation.operationId !== expected.operationId) throw new Error(`Operation ID drift: ${key}`);
    spec.paths[entry.path] ??= {};
    spec.paths[entry.path][entry.method.toLowerCase()] = entry.operation;
  }

  return spec;
}

function serializeSpec(spec) {
  return JSON.stringify(spec, null, 2) + "\n";
}

export function outputMatchesSerialized(serialized, artifact) {
  return artifact.equals(Buffer.from(serialized, "utf8"));
}

function parseMode(argv) {
  if (argv.length === 0) throw new Error("Expected exactly one argument: --write or --check");
  if (argv.length > 1) throw new Error("Expected exactly one argument: --write or --check");
  if (argv[0] !== "--write" && argv[0] !== "--check") throw new Error(`Unsupported argument: ${argv[0]}`);
  return argv[0];
}

function runCli(argv) {
  const mode = parseMode(argv);
  const contents = serializeSpec(buildSpec());

  if (mode === "--write") {
    writeFileSync(outputPath, contents);
    return;
  }

  if (!existsSync(outputPath)) throw new Error("OpenAPI output is missing: openapi.json");
  if (!outputMatchesSerialized(contents, readFileSync(outputPath))) {
    throw new Error("OpenAPI output is stale: openapi.json");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
