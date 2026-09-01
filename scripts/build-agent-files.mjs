import * as fileSystem from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { renderPublicManifest } from "./build-mcp-catalog.mjs";
import {
  acquireGeneratedPairWriterLock,
  assertGeneratedPairWriterLock,
  assertNoIncompleteTransactionForCheck,
  assertNoWriterLockForCheck,
  finishGeneratedPairWriterLockRecovery,
  isGeneratedPairReservedPath,
  recoverGeneratedPair,
  releaseGeneratedPairWriterLock,
  writeGeneratedSet
} from "./lib/atomic-generated-pair.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREVIEW_ORIGIN = "https://airscale.mintlify.app";
const OPERATIONAL_MCP_URL = "https://mcp.airscale.io/mcp";
const SOURCE_SHA = "b06ea2c46276f8415a97721f6901437ce07f13fa";
const SKILL_DESCRIPTION = "Search for people and companies, enrich professional contact data, run web research, and create asynchronous exports through the Airscale API or MCP server.";
const OUTPUT_PATHS = Object.freeze([
  "llms.txt",
  "llms-full.txt",
  "skill.md"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeText(value, label, { maxLength = 1_024 } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  if (/[^\P{C}\t\n\r]/u.test(value)) throw new Error(`${label} contains a control character`);
  if (/<\/?(?:script|style|iframe|object|embed)\b|(?:javascript|data|file):/iu.test(value)) {
    throw new Error(`${label} contains unsafe active content`);
  }
  return value.trim();
}

function assertSafeNavigationPath(value) {
  if (
    typeof value !== "string"
    || !value
    || isAbsolute(value)
    || value.includes("\\")
    || value.endsWith(".mdx")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || !/^[a-z0-9][a-z0-9()/_.-]*$/u.test(value)
  ) {
    throw new Error(`unsafe navigable page path: ${String(value)}`);
  }
  return value;
}

function navigationEntries(docsConfig) {
  if (!isPlainObject(docsConfig)) throw new Error("docs.json must contain an object");
  assertSafeText(docsConfig.name, "docs.json name", { maxLength: 120 });
  assertSafeText(docsConfig.description, "docs.json description", { maxLength: 500 });
  if (docsConfig.seo?.indexing !== "navigable" || docsConfig.seo?.metatags?.robots !== "noindex, follow") {
    throw new Error("docs.json must preserve the preview noindex boundary");
  }
  if (!Array.isArray(docsConfig.navigation?.tabs) || docsConfig.navigation.tabs.length === 0) {
    throw new Error("docs.json must define navigation tabs");
  }

  const seen = new Set();
  const entries = [];
  for (const tab of docsConfig.navigation.tabs) {
    const tabName = assertSafeText(tab?.tab, "navigation tab", { maxLength: 120 });
    if (!Array.isArray(tab.groups) || tab.groups.length === 0) throw new Error(`${tabName} must define navigation groups`);
    for (const group of tab.groups) {
      const groupName = assertSafeText(group?.group, `${tabName} navigation group`, { maxLength: 120 });
      if (!Array.isArray(group.pages) || group.pages.length === 0) {
        throw new Error(`${tabName} / ${groupName} must define navigable pages`);
      }
      for (const rawPath of group.pages) {
        const path = assertSafeNavigationPath(rawPath);
        if (seen.has(path)) throw new Error(`duplicate navigable page: ${path}`);
        seen.add(path);
        entries.push({ tab: tabName, group: groupName, path });
      }
    }
  }
  return entries;
}

function parsePage(path, source) {
  if (typeof source !== "string") throw new Error(`missing navigable page source: ${path}`);
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);
  if (!match) throw new Error(`${path} must have valid YAML frontmatter`);
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) throw new Error(`${path} has invalid YAML frontmatter: ${document.errors[0].message}`);
  const frontmatter = document.toJS();
  if (!isPlainObject(frontmatter)) throw new Error(`${path} frontmatter must be an object`);
  const title = assertSafeText(frontmatter.title, `${path} title`, { maxLength: 180 });
  const description = assertSafeText(frontmatter.description, `${path} description`, { maxLength: 500 });
  const expectedCanonical = `${PREVIEW_ORIGIN}/${path}`;
  if (frontmatter.canonical !== expectedCanonical) {
    throw new Error(`${path} canonical must use the preview URL ${expectedCanonical}`);
  }
  const body = match[2].replace(/^\s+|\s+$/gu, "");
  if (!body) throw new Error(`${path} body must not be empty`);
  if (/https:\/\/docs\.airscale\.io(?:[/:?#]|$)/iu.test(body)) {
    throw new Error(`${path} body contains the retained Framer domain`);
  }
  return { path, title, description, body };
}

function validateOpenApi(openapi) {
  if (!isPlainObject(openapi) || !/^3\.(?:0|1)\./u.test(openapi.openapi ?? "")) {
    throw new Error("openapi.json must be an OpenAPI 3.0 or 3.1 document");
  }
  assertSafeText(openapi.info?.title, "OpenAPI title", { maxLength: 180 });
  assertSafeText(openapi.info?.version, "OpenAPI version", { maxLength: 120 });
  if (!isPlainObject(openapi.paths) || Object.keys(openapi.paths).length === 0) {
    throw new Error("openapi.json must expose at least one path");
  }
  if (!Array.isArray(openapi.servers) || !openapi.servers.some(({ url }) => url === "https://api.airscale.io")) {
    throw new Error("openapi.json must identify the production Airscale API server");
  }
}

function validateMcpTools(mcpTools, mcpContract) {
  if (!isPlainObject(mcpTools)) throw new Error("mcp-tools.txt must contain a JSON object");
  if (!isPlainObject(mcpContract)) throw new Error("the source-pinned MCP contract must contain an object");
  let expectedManifest;
  try {
    expectedManifest = JSON.parse(renderPublicManifest(mcpContract));
  } catch (error) {
    throw new Error(`the source-pinned MCP contract is invalid: ${error.message}`, { cause: error });
  }
  if (!isDeepStrictEqual(mcpTools, expectedManifest)) {
    throw new Error("the public MCP manifest does not match the complete source-pinned contract");
  }
  if (mcpTools.sourceSha !== SOURCE_SHA) throw new Error("mcp-tools.txt source SHA does not match the pinned MCP contract");
  if (mcpTools.serverUrl !== OPERATIONAL_MCP_URL) throw new Error("mcp-tools.txt has an unexpected operational MCP URL");
  if (mcpTools.toolCount !== 22 || !Array.isArray(mcpTools.tools) || mcpTools.tools.length !== 22) {
    throw new Error("mcp-tools.txt must expose exactly 22 tools");
  }
  const names = new Set();
  for (const tool of mcpTools.tools) {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || names.has(tool.name)) {
      throw new Error("mcp-tools.txt must expose 22 uniquely named tool objects");
    }
    names.add(tool.name);
  }
  const airsearch = mcpTools.tools.find(({ name }) => name === "airscale_airsearch");
  if (airsearch?.spend?.summary !== "2 credits per call") {
    throw new Error("the pinned MCP manifest must price Airsearch at 2 credits per call");
  }
  const paidExports = mcpTools.tools.filter(({ spend }) => spend?.kind === "paid_export");
  if (
    paidExports.length !== 3
    || paidExports.some(({ spend }) => spend.confirmationField !== "confirm_credit_spend")
  ) {
    throw new Error("the pinned MCP manifest must require confirm_credit_spend for all three paid exports");
  }
}

function createModel(inputs) {
  if (!isPlainObject(inputs)) throw new Error("agent renderer inputs must be an object");
  const entries = navigationEntries(inputs.docsConfig);
  if (!isPlainObject(inputs.pageSources)) throw new Error("pageSources must contain navigable MDX source strings");
  const expectedPagePaths = new Set(entries.map(({ path }) => path));
  for (const path of Object.keys(inputs.pageSources)) {
    if (!expectedPagePaths.has(path)) throw new Error(`unexpected page source outside navigation: ${path}`);
  }
  const pages = entries.map((entry) => ({
    ...entry,
    ...parsePage(entry.path, inputs.pageSources[entry.path])
  }));
  validateOpenApi(inputs.openapi);
  validateMcpTools(inputs.mcpTools, inputs.mcpContract);
  return {
    siteName: inputs.docsConfig.name,
    siteDescription: inputs.docsConfig.description,
    pages,
    openapi: inputs.openapi,
    mcpTools: inputs.mcpTools
  };
}

function escapeMarkdownInline(value) {
  return value
    .replace(/\s+/gu, " ")
    .replace(/\\/gu, "\\\\")
    .replace(/([\[\]|])/gu, "\\$1")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function renderLlmsIndexModel(model) {
  const lines = [
    `# ${escapeMarkdownInline(model.siteName)}`,
    "",
    `> ${escapeMarkdownInline(model.siteDescription)}`,
    "> Preview documentation is intentionally noindex. Use only the airscale.mintlify.app links in this file.",
    ""
  ];
  let previousGroup = null;
  for (const page of model.pages) {
    const group = `${page.tab} — ${page.group}`;
    if (group !== previousGroup) {
      if (previousGroup !== null) lines.push("");
      lines.push(`## ${escapeMarkdownInline(group)}`, "");
      previousGroup = group;
    }
    lines.push(`- [${escapeMarkdownInline(page.title)}](${PREVIEW_ORIGIN}/${page.path}.md): ${escapeMarkdownInline(page.description)}`);
  }
  lines.push(
    "",
    "## Machine-readable contracts",
    "",
    `- [OpenAPI specification](${PREVIEW_ORIGIN}/openapi.json): HTTP API operations, schemas, authentication, and responses.`,
    `- [MCP tool catalog](${PREVIEW_ORIGIN}/mcp/tools.md): Hosted Markdown with names, input schemas, credit behavior, examples, and API mappings for all 22 operational MCP tools.`,
    `- [Agent resource directory](${PREVIEW_ORIGIN}/mcp/agent-resources.md): Human and machine entry points for Airscale agents and documentation consumers.`,
    `- [Agent skill](${PREVIEW_ORIGIN}/skill.md): Capability, authentication, credit, and approval guidance for agents.`,
    ""
  );
  return lines.join("\n");
}

function renderLlmsFullModel(model) {
  const lines = [
    `# ${escapeMarkdownInline(model.siteName)} full documentation`,
    "",
    `> ${escapeMarkdownInline(model.siteDescription)}`,
    "> This is the full public, navigable preview corpus. It remains intentionally noindex for traditional search engines.",
    ""
  ];
  for (const page of model.pages) {
    lines.push(
      `## ${escapeMarkdownInline(page.title)}`,
      "",
      `Source: ${PREVIEW_ORIGIN}/${page.path}.md`,
      "",
      `Description: ${escapeMarkdownInline(page.description)}`,
      "",
      page.body,
      "",
      "---",
      ""
    );
  }
  lines.push(
    "## Machine-readable contracts",
    "",
    `- [MCP tool catalog](${PREVIEW_ORIGIN}/mcp/tools.md): Hosted Markdown for all 22 operational MCP tools.`,
    `- [Agent resource directory](${PREVIEW_ORIGIN}/mcp/agent-resources.md): Human and machine entry points for Airscale agents and documentation consumers.`,
    ""
  );
  return lines.join("\n");
}

function renderSkillModel() {
  return `---
name: airscale
description: ${SKILL_DESCRIPTION}
metadata:
  version: "1.0"
  source_sha: "${SOURCE_SHA}"
---

# Airscale

Use Airscale to search for people and companies, enrich professional contact data, research the web, and create asynchronous exports. Start with free checks, keep paid samples narrow, and never execute a paid export without the user's explicit approval.

## Choose the correct interface

- Use the HTTP API when application code needs direct request and response control. Start at ${PREVIEW_ORIGIN}/api-reference/api-overview.
- Use the authenticated Airscale MCP product server at ${OPERATIONAL_MCP_URL} when an MCP client should call Airscale tools. Some tools spend workspace credits.
- Use the documentation-scoped MCP at ${PREVIEW_ORIGIN}/mcp only for documentation. Its search and filesystem tools are read-only; submit_feedback can send documentation feedback. It does not execute Airscale product tools or consume Airscale credits.

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

- MCP workflow and safety: ${PREVIEW_ORIGIN}/mcp/how-to-use-the-airscale-mcp
- MCP tool catalog (Markdown): ${PREVIEW_ORIGIN}/mcp/tools.md
- HTTP API reference: ${PREVIEW_ORIGIN}/api-reference/api-overview
- OpenAPI specification: ${PREVIEW_ORIGIN}/openapi.json
- Agent resource directory: ${PREVIEW_ORIGIN}/mcp/agent-resources

For the documentation MCP filesystem, run tree / -L 2 before reading files. Actual paths include /api-reference/api-overview.mdx and /mcp/airscale-mcp-server.mdx; generic example paths shown by a client may not exist. If an MCP-rendered API page shows repeated or conflicting request fields, trust the endpoint prose or ${PREVIEW_ORIGIN}/openapi.json.
`;
}

export function renderLlmsIndex(inputs) {
  return renderLlmsIndexModel(createModel(inputs));
}

export function renderLlmsFull(inputs) {
  return renderLlmsFullModel(createModel(inputs));
}

export function renderSkill(inputs) {
  createModel(inputs);
  return renderSkillModel();
}

export function renderAgentFiles(inputs) {
  const model = createModel(inputs);
  return {
    "llms.txt": renderLlmsIndexModel(model),
    "llms-full.txt": renderLlmsFullModel(model),
    "skill.md": renderSkillModel()
  };
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["--write", "--check"].includes(argv[0])) {
    throw new Error("Usage: node scripts/build-agent-files.mjs --write|--check");
  }
  return argv[0];
}

function lstatIfPresent(path, io) {
  try {
    return io.lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularFile(path, label, io, { required = true } = {}) {
  const stat = lstatIfPresent(path, io);
  if (!stat) {
    if (required) throw new Error(`${label} is missing: ${path}`);
    return null;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
  return stat;
}

function assertPathInsideRoot(path, rootDirectory, label) {
  const pathRelative = relative(rootDirectory, path);
  if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
    throw new Error(`${label} must be a descendant of the documentation root`);
  }
}

function assertSafeAncestors(path, rootDirectory, io, label = "output directory") {
  let current = dirname(path);
  while (current !== rootDirectory) {
    assertPathInsideRoot(current, rootDirectory, label);
    const stat = lstatIfPresent(current, io);
    if (stat?.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${current}`);
    if (stat && !stat.isDirectory()) throw new Error(`${label} must be a directory: ${current}`);
    current = dirname(current);
  }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

function readRegularFile(path, label, io, { encoding, required = true } = {}) {
  const initial = assertRegularFile(path, label, io, { required });
  if (!initial) return null;
  const noFollow = fileSystem.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow)) throw new Error("this platform cannot safely open generated files without following symbolic links");
  let descriptor;
  try {
    descriptor = io.openSync(path, fileSystem.constants.O_RDONLY | noFollow);
  } catch (error) {
    throw new Error(`${label} could not be opened without following symbolic links: ${path}: ${error.message}`, { cause: error });
  }
  try {
    const opened = io.fstatSync(descriptor);
    if (!opened.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
    if (!sameIdentity(initial, opened)) throw new Error(`${label} identity changed before it was opened: ${path}`);
    const contents = encoding === undefined
      ? io.readFileSync(descriptor)
      : io.readFileSync(descriptor, encoding);
    const finalDescriptor = io.fstatSync(descriptor);
    if (!finalDescriptor.isFile() || !sameIdentity(opened, finalDescriptor)) {
      throw new Error(`${label} descriptor identity changed while it was being read: ${path}`);
    }
    const finalPath = assertRegularFile(path, label, io, { required: true });
    if (!sameIdentity(opened, finalPath)) throw new Error(`${label} identity changed while it was being read: ${path}`);
    return contents;
  } finally {
    io.closeSync(descriptor);
  }
}

function validateTargetPaths(rootDirectory, sourcePaths, io) {
  const targetPaths = OUTPUT_PATHS.map((path) => resolve(rootDirectory, path));
  for (const targetPath of targetPaths) {
    assertPathInsideRoot(targetPath, rootDirectory, "agent output");
    assertSafeAncestors(targetPath, rootDirectory, io);
    assertRegularFile(targetPath, "agent output", io, { required: false });
  }
  for (let leftIndex = 0; leftIndex < targetPaths.length; leftIndex += 1) {
    const leftPath = targetPaths[leftIndex];
    const leftStat = lstatIfPresent(leftPath, io);
    for (let rightIndex = leftIndex + 1; rightIndex < targetPaths.length; rightIndex += 1) {
      const rightPath = targetPaths[rightIndex];
      const rightStat = lstatIfPresent(rightPath, io);
      if (leftPath === rightPath || sameIdentity(leftStat, rightStat)) {
        throw new Error("agent output paths must not collide or refer to the same file");
      }
      if (isGeneratedPairReservedPath(leftPath, rightPath) || isGeneratedPairReservedPath(rightPath, leftPath)) {
        throw new Error("agent outputs must not occupy another output's reserved transaction namespace");
      }
    }
    for (const sourcePath of sourcePaths) {
      if (leftPath === sourcePath || sameIdentity(leftStat, lstatIfPresent(sourcePath, io))) {
        throw new Error(`agent output would overwrite a generator input: ${basename(sourcePath)}`);
      }
    }
  }
  return targetPaths;
}

function readJson(path, label, io) {
  try {
    return JSON.parse(readRegularFile(path, label, io, { encoding: "utf8" }));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

function readInputs(rootDirectory, io) {
  const docsPath = resolve(rootDirectory, "docs.json");
  const openapiPath = resolve(rootDirectory, "openapi.json");
  const mcpToolsPath = resolve(rootDirectory, "mcp-tools.txt");
  const mcpContractPath = resolve(rootDirectory, "contracts/mcp-tools.json");
  for (const inputPath of [docsPath, openapiPath, mcpToolsPath, mcpContractPath]) {
    assertPathInsideRoot(inputPath, rootDirectory, "generator input");
    assertSafeAncestors(inputPath, rootDirectory, io, "generator input directory");
  }
  const docsConfig = readJson(docsPath, "docs.json", io);
  const entries = navigationEntries(docsConfig);
  const pageSources = {};
  const pagePaths = [];
  for (const { path } of entries) {
    const pagePath = resolve(rootDirectory, `${path}.mdx`);
    assertPathInsideRoot(pagePath, rootDirectory, "navigable page");
    assertSafeAncestors(pagePath, rootDirectory, io, "navigable page directory");
    assertRegularFile(pagePath, `navigable page ${path}`, io);
    pageSources[path] = readRegularFile(pagePath, `navigable page ${path}`, io, { encoding: "utf8" });
    pagePaths.push(pagePath);
  }
  const inputs = {
    docsConfig,
    pageSources,
    openapi: readJson(openapiPath, "openapi.json", io),
    mcpTools: readJson(mcpToolsPath, "mcp-tools.txt", io),
    mcpContract: readJson(mcpContractPath, "source-pinned MCP contract", io)
  };
  const outputs = renderAgentFiles(inputs);
  return {
    inputs,
    outputs,
    sourcePaths: [docsPath, openapiPath, mcpToolsPath, mcpContractPath, ...pagePaths]
  };
}

function validateRoot(rootDirectory, io) {
  const stat = lstatIfPresent(rootDirectory, io);
  if (!stat) throw new Error(`documentation root is missing: ${rootDirectory}`);
  if (stat.isSymbolicLink()) throw new Error(`documentation root must not be a symbolic link: ${rootDirectory}`);
  if (!stat.isDirectory()) throw new Error(`documentation root must be a directory: ${rootDirectory}`);
}

function bytesMatch(contents, artifact) {
  const bytes = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact);
  return bytes.equals(Buffer.from(contents, "utf8"));
}

function outputsAreFresh(outputs, targetPaths, io) {
  return targetPaths.every((targetPath, index) => {
    const artifact = readRegularFile(targetPath, `agent output ${OUTPUT_PATHS[index]}`, io, { required: false });
    return artifact !== null && bytesMatch(outputs[OUTPUT_PATHS[index]], artifact);
  });
}

export async function run(argv, dependencies = {}) {
  const mode = parseArguments(argv);
  const io = { ...fileSystem, ...(dependencies.fsImpl ?? {}) };
  const rootDirectory = resolve(dependencies.rootDir ?? PROJECT_ROOT);
  validateRoot(rootDirectory, io);
  const fixedTargetPaths = OUTPUT_PATHS.map((path) => resolve(rootDirectory, path));

  if (mode === "--check") {
    validateTargetPaths(rootDirectory, [], io);
    assertNoWriterLockForCheck(fixedTargetPaths, io);
    assertNoIncompleteTransactionForCheck(fixedTargetPaths, io);
    const { outputs, sourcePaths } = readInputs(rootDirectory, io);
    const targetPaths = validateTargetPaths(rootDirectory, sourcePaths, io);
    assertNoWriterLockForCheck(targetPaths, io);
    assertNoIncompleteTransactionForCheck(targetPaths, io);
    for (const [index, targetPath] of targetPaths.entries()) {
      const artifact = readRegularFile(targetPath, `agent output ${OUTPUT_PATHS[index]}`, io, { required: false });
      if (artifact === null) throw new Error(`agent output is missing: ${OUTPUT_PATHS[index]}`);
      if (!bytesMatch(outputs[OUTPUT_PATHS[index]], artifact)) {
        throw new Error(`agent output is stale: ${OUTPUT_PATHS[index]}`);
      }
    }
    validateTargetPaths(rootDirectory, sourcePaths, io);
    assertNoWriterLockForCheck(targetPaths, io);
    assertNoIncompleteTransactionForCheck(targetPaths, io);
    return;
  }

  let rendered = readInputs(rootDirectory, io);
  let targetPaths = validateTargetPaths(rootDirectory, rendered.sourcePaths, io);
  const transactionToken = `${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}`;
  const writerLock = acquireGeneratedPairWriterLock(targetPaths, transactionToken, io, {
    writerLockPhaseHook: dependencies.writerLockPhaseHook
  });
  let operationError = null;
  try {
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    recoverGeneratedPair(targetPaths, io, {
      recoverableTransactionTokens: writerLock.recoverableTransactionTokens
    });
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    finishGeneratedPairWriterLockRecovery(writerLock, io);
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);

    rendered = readInputs(rootDirectory, io);
    targetPaths = validateTargetPaths(rootDirectory, rendered.sourcePaths, io);
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    recoverGeneratedPair(targetPaths, io);
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    targetPaths = validateTargetPaths(rootDirectory, rendered.sourcePaths, io);

    if (outputsAreFresh(rendered.outputs, targetPaths, io)) {
      targetPaths = validateTargetPaths(rootDirectory, rendered.sourcePaths, io);
      assertGeneratedPairWriterLock(writerLock, targetPaths, io);
      return;
    }
    writeGeneratedSet(targetPaths.map((targetPath, index) => ({
      targetPath,
      contents: rendered.outputs[OUTPUT_PATHS[index]]
    })), {
      io,
      transactionToken,
      transactionPhaseHook: dependencies.transactionPhaseHook,
      writerLock
    });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseGeneratedPairWriterLock(writerLock, io);
    } catch (releaseError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, releaseError],
          `${operationError.message}; writer lock release was incomplete: ${releaseError.message}`
        );
      }
      throw releaseError;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
