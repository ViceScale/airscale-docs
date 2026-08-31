import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fileSystem from "node:fs";
import {
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import {
  ExampleSynthesisError,
  renderCatalog,
  renderPublicManifest,
  run
} from "../scripts/build-mcp-catalog.mjs";
import {
  acquireGeneratedPairWriterLock,
  finishGeneratedPairWriterLockRecovery,
  recoverGeneratedPair,
  releaseGeneratedPairWriterLock,
  writeGeneratedPair
} from "../scripts/lib/atomic-generated-pair.mjs";

const CATEGORY_GROUPS = [
  {
    key: "workspace",
    title: "Workspace",
    names: ["airscale_check_credits"]
  },
  {
    key: "search_and_research",
    title: "Search and research",
    names: [
      "airscale_find_people",
      "airscale_count_find_people",
      "airscale_find_companies",
      "airscale_find_companies_filter_values",
      "airscale_airsearch"
    ]
  },
  {
    key: "contact_and_profile_enrichment",
    title: "Contact and profile enrichment",
    names: [
      "airscale_find_email",
      "airscale_find_email_bulk",
      "airscale_find_mobile_phone",
      "airscale_find_personal_email",
      "airscale_find_people_by_url",
      "airscale_extract_people_profile",
      "airscale_extract_company_profile",
      "airscale_reverse_email",
      "airscale_reverse_phone"
    ]
  },
  {
    key: "async_exports_and_managed_batches",
    title: "Async exports and managed batches",
    names: [
      "airscale_start_companies_export",
      "airscale_start_people_export",
      "airscale_create_contact_enrichment_batch",
      "airscale_add_contacts_to_enrichment_batch",
      "airscale_start_contact_enrichment_export",
      "airscale_get_export_status",
      "airscale_get_export_file"
    ]
  }
];
const CORE_TOOLS = new Set(CATEGORY_GROUPS.slice(0, 3).flatMap(({ names }) => names));
const PAID_EXPORT_STARTS = [
  "airscale_start_companies_export",
  "airscale_start_people_export",
  "airscale_start_contact_enrichment_export"
];

function readContract() {
  return JSON.parse(readFileSync("contracts/mcp-tools.json", "utf8"));
}

function occurrences(source, literal) {
  return source.split(literal).length - 1;
}

function parseMarkdownTableRow(line) {
  assert.ok(line.startsWith("|") && line.endsWith("|"), `not a Markdown table row: ${line}`);
  const cells = [];
  let cell = "";
  let backslashes = 0;
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    if (character === "|" && backslashes % 2 === 0) {
      cells.push(cell.trim());
      cell = "";
      backslashes = 0;
      continue;
    }
    cell += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  cells.push(cell.trim());
  return cells;
}

function toolBlock(source, tool, nextTool) {
  const start = source.indexOf(`<a id="${tool.anchor}"></a>`);
  assert.notEqual(start, -1, `${tool.name} block must exist`);
  const end = nextTool ? source.indexOf(`<a id="${nextTool.anchor}"></a>`, start + 1) : source.length;
  return source.slice(start, end);
}

function markdownJsonExamples(source) {
  return [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function synthesizeFixtureArguments(inputSchema) {
  const contract = readContract();
  contract.tools[0].inputSchema = inputSchema;
  return markdownJsonExamples(renderCatalog(contract))[0].params.arguments;
}

function assertSynthesizedFixture(inputSchema, expected) {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(inputSchema);
  const actual = synthesizeFixtureArguments(inputSchema);
  assert.equal(validate(actual), true, ajv.errorsText(validate.errors));
  assert.deepEqual(actual, expected);
}

function fixtureInputRows(inputSchema) {
  const contract = readContract();
  contract.tools[0].inputSchema = inputSchema;
  const source = renderCatalog(contract);
  const block = toolBlock(source, contract.tools[0], contract.tools[1]);
  return block.split("\n").filter((line) => line.startsWith("| `"));
}

function assertDocumentationSafeArguments(toolName, argumentsValue) {
  if (toolName === "airscale_find_companies") {
    assert.ok(Object.keys(argumentsValue.filters ?? {}).length > 0, "find companies needs a real filter");
    assert.equal(argumentsValue.size, 1, "find companies must minimize returned paid rows");
  }
  if (toolName === "airscale_find_email") {
    const hasProfile = typeof argumentsValue.linkedin_profile_url === "string";
    const hasNamedCompany = typeof argumentsValue.first_name === "string"
      && typeof argumentsValue.last_name === "string"
      && (typeof argumentsValue.domain === "string" || typeof argumentsValue.company_name === "string");
    assert.ok(hasProfile || hasNamedCompany, "find email needs a complete supported identity");
  }
  if (toolName === "airscale_find_email_bulk") {
    for (const input of argumentsValue.inputs ?? []) {
      const identifyingKeys = ["linkedin_profile_url", "first_name", "last_name", "domain", "company_name"];
      assert.ok(identifyingKeys.some((key) => typeof input[key] === "string"), "bulk email inputs need contact identity, not only custom_id");
    }
  }
  if (["airscale_start_companies_export", "airscale_start_people_export"].includes(toolName)) {
    assert.equal(argumentsValue.max_rows, 1, `${toolName} must cap the paid example at one row`);
    assert.equal(argumentsValue.format, "csv");
    assert.equal(argumentsValue.confirm_credit_spend, true);
    const narrowInput = argumentsValue.filters ?? argumentsValue.query;
    assert.ok(narrowInput && Object.keys(narrowInput).length > 0, `${toolName} needs one narrow query or filter`);
  }
}

function inTemporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "airscale-mcp-catalog-"));
  return Promise.resolve()
    .then(() => callback(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }));
}

function assertNoTransactionFiles(directory) {
  assert.deepEqual(
    readdirSync(directory).filter((name) => (
      name.endsWith(".tmp")
      || name.endsWith(".bak")
      || name.includes(".mcp-pair-transaction.json")
      || name.includes(".mcp-pair-write.lock")
    )),
    []
  );
}

function transactionFiles(directory, suffix) {
  return readdirSync(directory).filter((name) => name.endsWith(suffix));
}

function snapshotRegularFiles(paths) {
  return paths.map((path) => {
    const stat = lstatSync(path);
    return {
      path,
      device: String(stat.dev),
      inode: String(stat.ino),
      contents: readFileSync(path)
    };
  });
}

function createUncommittedJournalFixture(directory) {
  const catalogPath = join(directory, "tools.mdx");
  const publicPath = join(directory, "mcp-tools.json");
  const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
  const token = "123.456.deadbeef";
  const entries = [catalogPath, publicPath].map((targetPath, index) => {
    const temporaryPath = `${targetPath}.${token}.tmp`;
    const backupPath = `${targetPath}.${token}.bak`;
    writeFileSync(backupPath, `original output ${index}\n`);
    const originalStat = lstatSync(backupPath);
    writeFileSync(targetPath, `installed output ${index}\n`);
    const temporaryStat = lstatSync(targetPath);
    linkSync(targetPath, temporaryPath);
    return {
      targetPath,
      temporaryPath,
      backupPath,
      hadTarget: true,
      originalIdentity: { device: String(originalStat.dev), inode: String(originalStat.ino) },
      temporaryIdentity: { device: String(temporaryStat.dev), inode: String(temporaryStat.ino) }
    };
  });
  writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: false, entries }, null, 2)}\n`);
  return {
    catalogPath,
    publicPath,
    journalPath,
    updatePath: `${journalPath}.next`,
    entries,
    transactionPaths: [
      catalogPath,
      publicPath,
      journalPath,
      ...entries.flatMap(({ temporaryPath, backupPath }) => [temporaryPath, backupPath])
    ]
  };
}

function crashWriterAt(phase, catalogPath, publicPath) {
  const generatorUrl = new URL("../scripts/build-mcp-catalog.mjs", import.meta.url).href;
  const source = `
    import { writeFileSync as realWriteFileSync } from "node:fs";
    import { run } from ${JSON.stringify(generatorUrl)};
    await run(${JSON.stringify(["--write", "--catalog", catalogPath, "--public", publicPath])}, {
      fsImpl: {
        writeFileSync(path, contents, options) {
          if (${JSON.stringify(phase)} === "initial-journal-write" && path.endsWith(".stage")) {
            realWriteFileSync(path, String(contents).slice(0, 24), options);
            process.kill(process.pid, "SIGKILL");
          }
          return realWriteFileSync(path, contents, options);
        }
      },
      transactionPhaseHook(currentPhase) {
        if (currentPhase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
      },
      writerLockPhaseHook(currentPhase) {
        if (currentPhase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
      }
    });
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" });
}

function writerChildSource(catalogPath, publicPath, {
  contractPath = null,
  pauseAtTemporaryFiles = false,
  pauseAtWriterLockPhase = null
} = {}) {
  const generatorUrl = new URL("../scripts/build-mcp-catalog.mjs", import.meta.url).href;
  const argumentsValue = [
    "--write",
    ...(contractPath ? ["--contract", contractPath] : []),
    "--catalog",
    catalogPath,
    "--public",
    publicPath
  ];
  return `
    import { readFileSync } from "node:fs";
    import { run } from ${JSON.stringify(generatorUrl)};
    try {
      await run(${JSON.stringify(argumentsValue)}, {
        transactionPhaseHook(phase) {
          if (${JSON.stringify(pauseAtTemporaryFiles)} && phase === "temporary-files") {
            process.stdout.write("READY\\n");
            readFileSync(0, "utf8");
          }
        },
        writerLockPhaseHook(phase) {
          if (phase === ${JSON.stringify(pauseAtWriterLockPhase)}) {
            process.stdout.write("READY\\n");
            readFileSync(0, "utf8");
          }
        }
      });
      process.stdout.write("OK\\n");
    } catch (error) {
      process.stdout.write(\`ERROR \${error.name}: \${error.message}\\n\`);
      process.exitCode = 2;
    }
  `;
}

function waitForChildOutput(child, expected, output) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`timed out waiting for child output ${JSON.stringify(expected)}; received ${output.value}`));
    }, 10_000);
    function finishIfReady() {
      if (!output.value.includes(expected)) return;
      clearTimeout(timeout);
      child.stdout.off("data", finishIfReady);
      resolvePromise();
    }
    child.stdout.on("data", finishIfReady);
    finishIfReady();
  });
}

function waitForChildExit(child, stdout, stderr) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal, stdout: stdout.value, stderr: stderr.value }));
  });
}

test("catalog renderer emits the exact page framing, category order, headings, anchors, and summary links", () => {
  const contract = readContract();
  const source = renderCatalog(contract);
  const expectedFrontmatter = `---\ntitle: "MCP tool catalog"\ndescription: "Browse all 22 typed tools exposed by the Airscale MCP server."\ncanonical: "https://airscale.mintlify.app/mcp/tools"\n---\n`;

  assert.equal(source.startsWith(expectedFrontmatter), true);
  assert.match(
    source,
    /Airscale MCP exposes 22 typed tools for workspace checks, search, enrichment, research, managed batches, and asynchronous exports\./
  );
  assert.match(source, /<Warning>[\s\S]*Review each tool's credit behavior[\s\S]*`confirm_credit_spend: true`[\s\S]*<\/Warning>/);
  assert.equal(source.endsWith("\n"), true);
  assert.equal(source.endsWith("\n\n"), false);

  let previousCategoryIndex = -1;
  for (const group of CATEGORY_GROUPS) {
    const categoryIndex = source.indexOf(`## ${group.title}\n`);
    assert.ok(categoryIndex > previousCategoryIndex, `${group.title} must preserve category order`);
    previousCategoryIndex = categoryIndex;
    const firstAnchorIndex = source.indexOf(`<a id=`, categoryIndex);
    const summary = source.slice(categoryIndex, firstAnchorIndex);
    assert.match(summary, /\| Tool \| Purpose \| Credit behavior \| Execution \|/);
    for (const name of group.names) {
      const tool = contract.tools.find((entry) => entry.name === name);
      assert.match(summary, new RegExp(`\\[\\\`${name}\\\`\\]\\(#${tool.anchor}\\)`));
    }
  }

  for (const tool of contract.tools) {
    assert.equal(occurrences(source, `<a id="${tool.anchor}"></a>`), 1, `${tool.name} anchor`);
    assert.equal(occurrences(source, `### \`${tool.name}\``), 1, `${tool.name} heading`);
  }
});

test("every tool block keeps purpose, label, metadata, top-level inputs, result behavior, and security visible", () => {
  const contract = readContract();
  const source = renderCatalog(contract);

  for (const [index, tool] of contract.tools.entries()) {
    const block = toolBlock(source, tool, contract.tools[index + 1]);
    const categoryTitle = CATEGORY_GROUPS.find(({ key }) => key === tool.category).title;
    assert.ok(block.indexOf(`<a id="${tool.anchor}"></a>`) < block.indexOf(`### \`${tool.name}\``));
    assert.match(block, /\*\*MCP tool\*\*/);
    assert.ok(block.includes(tool.description), `${tool.name} runtime description`);
    assert.ok(block.includes(`**Category:** ${categoryTitle}`), `${tool.name} category`);
    assert.ok(block.includes(`**Credit behavior:** ${tool.spend.summary}`), `${tool.name} spend`);
    assert.ok(block.includes(`**Execution:** ${tool.asynchronous ? "Asynchronous" : "Synchronous"}`));
    assert.match(block, /\*\*Authentication:\*\*[^\n]+never include an API key in tool arguments/i);
    assert.match(block, /#### Inputs\n\n\| Field \| Type \| Required \| Description \| Constraints \|/);
    assert.match(block, /#### Minimal `tools\/call` example/);
    assert.match(block, /#### Expected result\n\n[^\n]+/);

    const required = new Set(tool.inputSchema.required ?? []);
    for (const property of Object.keys(tool.inputSchema.properties ?? {})) {
      assert.match(block, new RegExp(`\\| \\\`${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\` \\|`));
      const row = block.split("\n").find((line) => line.startsWith(`| \`${property}\` |`));
      assert.ok(row, `${tool.name}.${property} input row`);
      assert.ok(row.includes(`| ${required.has(property) ? "Yes" : "No"} |`));
    }
  }
});

test("catalog documents Airsearch cost, paid confirmations, core API links, and no invented batch API mappings", () => {
  const contract = readContract();
  const source = renderCatalog(contract);
  const toolsByName = new Map(contract.tools.map((tool) => [tool.name, tool]));

  assert.match(toolBlock(source, toolsByName.get("airscale_airsearch"), toolsByName.get("airscale_find_email")), /2 credits per call/);
  for (const name of PAID_EXPORT_STARTS) {
    const index = contract.tools.findIndex((tool) => tool.name === name);
    const block = toolBlock(source, contract.tools[index], contract.tools[index + 1]);
    assert.match(block, /confirm_credit_spend: true/);
    assert.match(block, /"confirm_credit_spend": true/);
  }

  assert.equal(occurrences(source, "**Related API reference:**"), 15);
  for (const tool of contract.tools) {
    const index = contract.tools.indexOf(tool);
    const block = toolBlock(source, tool, contract.tools[index + 1]);
    if (CORE_TOOLS.has(tool.name)) {
      assert.ok(block.includes(`(${tool.apiPage})`), `${tool.name} API page`);
      assert.equal(typeof tool.operationId, "string");
    } else {
      assert.equal(block.includes("**Related API reference:**"), false, `${tool.name} must not invent an API mapping`);
      assert.equal(tool.operationId, null);
      assert.equal(tool.apiPage, null);
    }
  }
});

test("every generated tools/call example parses, stays synthetic, and validates against its exact input schema", () => {
  const contract = readContract();
  const source = renderCatalog(contract);
  const examples = markdownJsonExamples(source);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);

  assert.equal(examples.length, 22);
  for (const [index, example] of examples.entries()) {
    const tool = contract.tools[index];
    assert.deepEqual(
      { jsonrpc: example.jsonrpc, method: example.method, name: example.params?.name },
      { jsonrpc: "2.0", method: "tools/call", name: tool.name }
    );
    const validate = ajv.compile(tool.inputSchema);
    assert.equal(
      validate(example.params.arguments),
      true,
      `${tool.name}: ${ajv.errorsText(validate.errors)}`
    );
    assertDocumentationSafeArguments(tool.name, example.params.arguments);
  }

  const serialized = JSON.stringify(examples);
  assert.doesNotMatch(serialized, /(?:api[_-]?key|authorization|bearer|password|secret|token)/i);
  assert.doesNotMatch(serialized, /(?:Prospeo|Icypeas|RapidAPI|Leadmagic|SalesQL|Limadata|ContactOut|Wiza|Forager|Bounceban|Findymail)/i);
  for (const value of serialized.match(/https?:\\?\/\\?\/[^"\\]+/g) ?? []) {
    if (/linkedin\.com/i.test(value)) assert.match(value, /example-(?:person|company)/);
    else assert.match(value, /example\.(?:com|org|net|test)/i);
  }

  const examplesByTool = new Map(examples.map((example) => [example.params.name, example.params.arguments]));
  assert.deepEqual(examplesByTool.get("airscale_find_people"), {
    query: { companyDomain: { include: ["example.com"] } },
    size: 1
  });
  assert.deepEqual(examplesByTool.get("airscale_find_companies"), {
    filters: { companyName: "Example Company" },
    size: 1
  });
  assert.deepEqual(examplesByTool.get("airscale_find_email"), {
    first_name: "Example",
    last_name: "Person",
    domain: "example.com"
  });
  assert.deepEqual(examplesByTool.get("airscale_find_email_bulk"), {
    webhook_url: "https://hooks.example.com/airscale",
    inputs: [{
      custom_id: "example-contact-1",
      first_name: "Example",
      last_name: "Person",
      domain: "example.com"
    }]
  });
  assert.deepEqual(examplesByTool.get("airscale_extract_company_profile"), {
    linkedin_profile_url: "https://www.linkedin.com/company/example-company"
  });
  assert.deepEqual(examplesByTool.get("airscale_start_companies_export"), {
    filters: { companyName: "Example Company" },
    max_rows: 1,
    format: "csv",
    confirm_credit_spend: true
  });
  assert.deepEqual(examplesByTool.get("airscale_start_people_export"), {
    query: { companyDomain: { include: ["example.com"] } },
    max_rows: 1,
    format: "csv",
    confirm_credit_spend: true
  });
  assert.deepEqual(examplesByTool.get("airscale_create_contact_enrichment_batch"), {
    name: "Example contact enrichment batch"
  });
  assert.deepEqual(examplesByTool.get("airscale_add_contacts_to_enrichment_batch"), {
    batch_id: "example-batch-id",
    contacts: [{
      custom_id: "example-contact-1",
      first_name: "Example",
      last_name: "Person",
      domain: "example.com"
    }]
  });
  assert.deepEqual(examplesByTool.get("airscale_start_contact_enrichment_export"), {
    batch_id: "example-batch-id",
    enrichments: ["work_email"],
    format: "csv",
    confirm_credit_spend: true
  });
});

test("documentation safety invariant rejects prior empty and default-spend examples", () => {
  assert.throws(() => assertDocumentationSafeArguments("airscale_find_companies", {}), /real filter/);
  assert.throws(() => assertDocumentationSafeArguments("airscale_find_email", {}), /complete supported identity/);
  assert.throws(
    () => assertDocumentationSafeArguments("airscale_find_email_bulk", {
      webhook_url: "https://hooks.example.com/airscale",
      inputs: [{ custom_id: "example-custom-id" }]
    }),
    /contact identity/
  );
  assert.throws(
    () => assertDocumentationSafeArguments("airscale_start_companies_export", { confirm_credit_spend: true }),
    /cap the paid example/
  );
  assert.throws(
    () => assertDocumentationSafeArguments("airscale_start_people_export", {
      query: { firstname: { include: ["example"] } },
      confirm_credit_spend: true
    }),
    /cap the paid example/
  );
});

test("escaped-pipe-aware parsing proves exact input and summary table cell counts", () => {
  assert.deepEqual(
    parseMarkdownTableRow("| purpose with \\| delimiter | Sync |"),
    ["purpose with \\| delimiter", "Sync"]
  );

  const source = renderCatalog(readContract());
  let expectedCells = null;
  let inputRows = 0;
  let summaryRows = 0;
  for (const line of source.split("\n")) {
    if (line === "| Field | Type | Required | Description | Constraints |") expectedCells = 5;
    else if (line === "| Tool | Purpose | Credit behavior | Execution |") expectedCells = 4;
    else if (!line.startsWith("|")) {
      expectedCells = null;
      continue;
    }
    if (line.startsWith("|") && expectedCells !== null) {
      assert.equal(parseMarkdownTableRow(line).length, expectedCells, line);
      if (!line.includes("---")) {
        if (expectedCells === 5) inputRows += 1;
        else summaryRows += 1;
      }
    }
  }
  assert.ok(inputRows > 22, "input headers and rendered field rows were parsed");
  assert.equal(summaryRows, 26, "four category headers plus twenty-two tool summary rows were parsed");

  const proseContract = readContract();
  proseContract.tools[0].description = "Backslash \\| pipe";
  const proseSummaryRow = renderCatalog(proseContract).split("\n")
    .find((line) => line.startsWith("| [`airscale_check_credits`]"));
  assert.equal(parseMarkdownTableRow(proseSummaryRow).length, 4);

  const propertyRows = fixtureInputRows({
    type: "object",
    required: ["a|b"],
    properties: { "a|b": { type: "string", description: "Backslash \\| pipe" } },
    additionalProperties: false
  });
  assert.equal(propertyRows.length, 1);
  assert.equal(parseMarkdownTableRow(propertyRows[0]).length, 5);
});

test("example synthesis fails closed with a named error when a required value cannot be generated", () => {
  const contract = readContract();
  const broken = structuredClone(contract);
  broken.tools[0].inputSchema = {
    type: "object",
    required: ["impossible"],
    properties: { impossible: false },
    additionalProperties: false
  };
  assert.throws(() => renderCatalog(broken), ExampleSynthesisError);
});

test("example synthesis resolves local refs together with their sibling constraints", () => {
  assertSynthesizedFixture({
    type: "object",
    $defs: {
      nonnegativeInteger: { type: "integer", minimum: 0 }
    },
    required: ["value"],
    properties: {
      value: {
        $ref: "#/$defs/nonnegativeInteger",
        minimum: 5,
        maximum: 10
      }
    },
    additionalProperties: false
  }, { value: 5 });
});

test("example synthesis resolves root-local JSON Pointer refs with sibling constraints", () => {
  assertSynthesizedFixture({
    $id: "https://schemas.example.test/mcp-input",
    type: "object",
    required: ["value"],
    properties: {
      template: { type: "integer", minimum: 5 },
      value: {
        $ref: "#/properties/template",
        maximum: 10
      }
    },
    additionalProperties: false
  }, { value: 5 });
});

test("example synthesis intersects numeric allOf constraints", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        allOf: [
          { type: "integer", minimum: 5 },
          { type: "integer", maximum: 10 }
        ]
      }
    },
    additionalProperties: false
  }, { value: 5 });
});

test("example synthesis derives a valid multiple inside an allOf intersection", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        allOf: [
          { type: "integer", minimum: 10 },
          { type: "integer", multipleOf: 7 }
        ]
      }
    },
    additionalProperties: false
  }, { value: 14 });
});

test("example synthesis tries a later anyOf branch when the first candidate fails sibling constraints", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        anyOf: [
          { type: "integer", minimum: 0, maximum: 0 },
          { type: "integer", minimum: 5, maximum: 5 }
        ],
        minimum: 5
      }
    },
    additionalProperties: false
  }, { value: 5 });
});

test("example synthesis combines later anyOf branch bounds with sibling multiples", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        anyOf: [
          { const: 0 },
          { type: "integer", minimum: 10 }
        ],
        minimum: 10,
        multipleOf: 7
      }
    },
    additionalProperties: false
  }, { value: 14 });
});

test("example synthesis finds a oneOf candidate that matches exactly one overlapping branch", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        oneOf: [
          { type: "integer", minimum: 0 },
          { type: "integer", minimum: 0, maximum: 0 }
        ]
      }
    },
    additionalProperties: false
  }, { value: 1 });
});

test("example synthesis tests values immediately outside overlapping oneOf boundaries", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        oneOf: [
          { type: "integer", minimum: 100 },
          { type: "integer", minimum: 100, maximum: 200 }
        ]
      }
    },
    additionalProperties: false
  }, { value: 201 });
});

test("example synthesis explicitly covers arrays, objects, enums, consts, and formats", () => {
  assertSynthesizedFixture({
    type: "object",
    required: ["items", "settings", "choice", "fixed", "email", "webhook_url"],
    properties: {
      items: { type: "array", minItems: 2, items: { type: "string", minLength: 1 } },
      settings: {
        type: "object",
        required: ["enabled"],
        properties: { enabled: { type: "boolean" } },
        additionalProperties: false
      },
      choice: { type: "string", enum: ["first", "second"] },
      fixed: { const: "constant" },
      email: { type: "string", format: "email" },
      webhook_url: { type: "string", format: "uri" }
    },
    additionalProperties: false
  }, {
    items: ["example", "example"],
    settings: { enabled: false },
    choice: "first",
    fixed: "constant",
    email: "person@example.com",
    webhook_url: "https://hooks.example.com/airscale"
  });
});

test("example synthesis rejects oversized arrays and strings before allocation", () => {
  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["items"],
    properties: { items: { type: "array", minItems: 20_000, items: { type: "string" } } }
  }), (error) => error instanceof ExampleSynthesisError && /array item budget/i.test(error.message));

  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["value"],
    properties: { value: { type: "string", minLength: 1_000_000 } }
  }), (error) => error instanceof ExampleSynthesisError && /string length budget/i.test(error.message));

  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["value"],
    properties: { value: { type: "string", maxLength: 1_000_000_000 } }
  }), (error) => error instanceof ExampleSynthesisError && /string length budget/i.test(error.message));

  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["value"],
    properties: { value: { enum: Array.from({ length: 129 }, (_, index) => index) } }
  }), (error) => error instanceof ExampleSynthesisError && /enum value budget/i.test(error.message));
});

test("example synthesis rejects broad combinators before candidate search", () => {
  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["value"],
    properties: {
      value: {
        anyOf: Array.from({ length: 129 }, (_, index) => ({ const: index }))
      }
    }
  }), (error) => error instanceof ExampleSynthesisError && /combinator branch budget/i.test(error.message));
});

test("example synthesis rejects deep nesting, local ref chains, and cycles", () => {
  let nested = { type: "string" };
  for (let index = 0; index < 80; index += 1) {
    nested = { type: "object", required: ["next"], properties: { next: nested } };
  }
  assert.throws(
    () => synthesizeFixtureArguments(nested),
    (error) => error instanceof ExampleSynthesisError && /recursion depth budget/i.test(error.message)
  );

  const definitions = {};
  for (let index = 0; index < 40; index += 1) {
    definitions[`node${index}`] = index === 39
      ? { type: "string" }
      : { $ref: `#/$defs/node${index + 1}` };
  }
  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    $defs: definitions,
    required: ["value"],
    properties: { value: { $ref: "#/$defs/node0" } }
  }), (error) => error instanceof ExampleSynthesisError && /reference depth budget/i.test(error.message));

  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    $defs: { loop: { $ref: "#/$defs/loop" } },
    required: ["value"],
    properties: { value: { $ref: "#/$defs/loop" } }
  }), (error) => error instanceof ExampleSynthesisError && /recursive schema reference/i.test(error.message));
});

test("example synthesis fails closed on a depth-18 binary local-ref DAG", () => {
  const definitions = {
    node0: {
      type: "object",
      required: ["leaf"],
      properties: { leaf: { type: "string" } },
      additionalProperties: false
    }
  };
  for (let index = 1; index <= 18; index += 1) {
    definitions[`node${index}`] = {
      allOf: [
        { $ref: `#/$defs/node${index - 1}` },
        { $ref: `#/$defs/node${index - 1}` }
      ]
    };
  }

  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    $defs: definitions,
    required: ["value"],
    properties: { value: { $ref: "#/$defs/node18" } },
    additionalProperties: false
  }), (error) => (
    error instanceof ExampleSynthesisError
    && /(?:reference expansion|candidate work|output structure) budget/i.test(error.message)
  ));
});

test("example synthesis charges repeated item structure before array materialization", () => {
  const itemProperties = Object.fromEntries(Array.from(
    { length: 40 },
    (_, index) => [`field_${index}`, { const: index }]
  ));
  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        minItems: 1_000,
        maxItems: 1_000,
        items: {
          type: "object",
          required: Object.keys(itemProperties),
          properties: itemProperties,
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  }), (error) => (
    error instanceof ExampleSynthesisError
    && /output structure.*before array materialization/i.test(error.message)
  ));
});

test("example synthesis rejects arguments over the serialized byte budget", () => {
  const properties = Object.fromEntries(Array.from(
    { length: 100 },
    (_, index) => [`field_${index}`, { type: "string", minLength: 200 }]
  ));
  assert.throws(() => synthesizeFixtureArguments({
    type: "object",
    required: Object.keys(properties),
    properties,
    additionalProperties: false
  }), (error) => error instanceof ExampleSynthesisError && /serialized example byte budget/i.test(error.message));
});

test("input table conjoins referenced and sibling constraints", () => {
  assert.deepEqual(fixtureInputRows({
    type: "object",
    $defs: {
      nonnegative: {
        type: "integer",
        minimum: 0,
        description: "A nonnegative integer."
      }
    },
    required: ["value"],
    properties: {
      value: {
        $ref: "#/$defs/nonnegative",
        minimum: 5,
        maximum: 10,
        description: "A narrow bounded value."
      }
    },
    additionalProperties: false
  }), [
    "| `value` | `integer` | Yes | A narrow bounded value. | minimum: 5; maximum: 10 |"
  ]);
});

test("input table intersects referenced and sibling enum assertions", () => {
  assert.deepEqual(fixtureInputRows({
    type: "object",
    $defs: {
      baseChoice: {
        type: "integer",
        enum: [1, 2],
        description: "Base choice."
      }
    },
    properties: {
      choice: {
        $ref: "#/$defs/baseChoice",
        enum: [2, 3],
        description: "Intersected choice."
      }
    },
    additionalProperties: false
  }), [
    "| `choice` | `integer` | No | Intersected choice. | allowed values: `2` |"
  ]);
});

test("input table preserves type, pattern, format, and multiple conjunctions", () => {
  assert.deepEqual(fixtureInputRows({
    type: "object",
    properties: {
      typed: {
        allOf: [
          { type: ["string", "number"] },
          { type: ["integer", "boolean"] }
        ],
        description: "Intersected type."
      },
      patterned: {
        allOf: [
          { type: "string", pattern: "^a", format: "hostname" },
          { type: "string", pattern: "z$", format: "uri" }
        ],
        description: "Conjoined string assertions."
      },
      stepped: {
        allOf: [
          { type: "integer", multipleOf: 2 },
          { type: "integer", multipleOf: 3 }
        ],
        description: "Conjoined numeric assertions."
      }
    },
    additionalProperties: false
  }), [
    "| `typed` | `integer` | No | Intersected type. | — |",
    "| `patterned` | `string` | No | Conjoined string assertions. | formats: `hostname`, `uri`; patterns: `^a`, `z$` |",
    "| `stepped` | `integer` | No | Conjoined numeric assertions. | multiples of: 2, 3 |"
  ]);
});

test("input table type code spans decode to literal generic type text", () => {
  const row = fixtureInputRows({
    type: "object",
    properties: {
      values: { type: "array", items: { type: "string" }, description: "Values." }
    },
    additionalProperties: false
  })[0];
  const markdown = `| Field | Type | Required | Description | Constraints |\n| --- | --- | --- | --- | --- |\n${row}\n`;
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  const typeCell = tree.children[0].children[1].children[1];
  assert.deepEqual(typeCell.children.map(({ type, value }) => ({ type, value })), [
    { type: "inlineCode", value: "array<string>" }
  ]);
});

test("input table constraint code spans preserve backticks and backslashes in the Markdown AST", () => {
  const rows = fixtureInputRows({
    type: "object",
    properties: {
      tick_pattern: { type: "string", pattern: "^a`b$", description: "Tick pattern." },
      slash_pattern: { type: "string", pattern: "^\\d+$", description: "Slash pattern." },
      tick_enum: { type: "string", enum: ["a`b"], description: "Tick enum." }
    },
    additionalProperties: false
  });
  const markdown = [
    "| Field | Type | Required | Description | Constraints |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  const parsedRows = Object.fromEntries(tree.children[0].children.slice(1).map((row) => {
    const field = row.children[0].children.find(({ type }) => type === "inlineCode")?.value;
    const constraintCodes = row.children[4].children
      .filter(({ type }) => type === "inlineCode")
      .map(({ value }) => value);
    return [field, constraintCodes];
  }));
  assert.deepEqual(parsedRows, {
    tick_pattern: ["^a`b$"],
    slash_pattern: ["^\\d+$"],
    tick_enum: ["\"a`b\""]
  });
});

test("input table constraint code spans preserve boundary spaces and pipes after backslashes", () => {
  const rows = fixtureInputRows({
    type: "object",
    properties: {
      spaced_pattern: { type: "string", pattern: " leading ", description: "Spaced pattern." },
      escaped_pipe_pattern: { type: "string", pattern: "^\\|$", description: "Escaped-pipe pattern." }
    },
    additionalProperties: false
  });
  for (const row of rows) assert.equal(parseMarkdownTableRow(row).length, 5, row);

  const markdown = [
    "| Field | Type | Required | Description | Constraints |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  const parsedRows = Object.fromEntries(tree.children[0].children.slice(1).map((row) => {
    assert.equal(row.children.length, 5);
    const field = row.children[0].children.find(({ type }) => type === "inlineCode")?.value;
    return [field, row.children[4].children.map(({ type, value }) => ({ type, value }))];
  }));
  assert.deepEqual(parsedRows, {
    spaced_pattern: [
      { type: "text", value: "pattern: " },
      { type: "inlineCode", value: " leading " }
    ],
    escaped_pipe_pattern: [
      { type: "text", value: "pattern: " },
      { type: "html", value: "<code>" },
      { type: "text", value: "^\\|$" },
      { type: "html", value: "</code>" }
    ]
  });
});

test("input table resolves top-level ref and allOf properties", () => {
  assert.deepEqual(fixtureInputRows({
    $defs: {
      input: {
        type: "object",
        required: ["alpha"],
        properties: {
          alpha: { type: "string", minLength: 2, description: "Alpha value." }
        },
        additionalProperties: false
      }
    },
    $ref: "#/$defs/input"
  }), [
    "| `alpha` | `string` | Yes | Alpha value. | minimum length: 2 |"
  ]);

  assert.deepEqual(fixtureInputRows({
    allOf: [
      {
        type: "object",
        properties: { first: { type: "boolean", description: "First flag." } }
      },
      {
        type: "object",
        required: ["limit"],
        properties: { limit: { type: "integer", minimum: 1, description: "Row limit." } }
      }
    ]
  }), [
    "| `first` | `boolean` | No | First flag. | — |",
    "| `limit` | `integer` | Yes | Row limit. | minimum: 1 |"
  ]);
});

test("public manifest exposes only public metadata, exact schemas, and documentation-safe links", () => {
  const contract = readContract();
  const serialized = renderPublicManifest(contract);
  const output = JSON.parse(serialized);

  assert.equal(serialized.endsWith("\n"), true);
  assert.equal(serialized.endsWith("\n\n"), false);
  assert.deepEqual(Object.keys(output), [
    "schemaVersion",
    "name",
    "description",
    "serverUrl",
    "toolCount",
    "sourceSha",
    "tools"
  ]);
  assert.equal(output.schemaVersion, "1.0");
  assert.equal(output.name, "Airscale MCP tools");
  assert.equal(output.description, "Browse all 22 typed tools exposed by the Airscale MCP server.");
  assert.equal(output.serverUrl, "https://mcp.airscale.io/mcp");
  assert.equal(output.toolCount, 22);
  assert.equal(output.sourceSha, contract.sourceSha);
  assert.equal(output.tools.length, 22);
  assert.equal(Object.hasOwn(output, "sourceFiles"), false);
  assert.equal(Object.hasOwn(output, "sourceRepository"), false);

  for (const [index, tool] of output.tools.entries()) {
    assert.deepEqual(Object.keys(tool), [
      "name",
      "anchor",
      "category",
      "description",
      "inputSchema",
      "spend",
      "asynchronous",
      "operationId",
      "apiPage"
    ]);
    assert.deepEqual(tool.inputSchema, contract.tools[index].inputSchema);
  }
  assert.doesNotMatch(serialized, /sourceFiles|mcp\/airscale-public-api|docs\.airscale\.io/);
  for (const tool of output.tools.filter(({ apiPage }) => apiPage !== null)) {
    assert.match(tool.apiPage, /^\/api-reference\//);
  }
});

test("renderers reject hostile tool identifiers and API routes", () => {
  for (const [field, value, expected] of [
    ["name", "airscale_bad`\n<script>", /tool name grammar/i],
    ["anchor", "airscale-good\"><script>", /anchor grammar/i],
    ["operationId", "bad](javascript:alert(1))", /operation id grammar/i],
    ["apiPage", "/api-reference/../../admin", /API page route grammar/i]
  ]) {
    const contract = readContract();
    contract.tools[0][field] = value;
    assert.throws(() => renderCatalog(contract), expected, field);
    assert.throws(() => renderPublicManifest(contract), expected, field);
  }
});

test("catalog escapes table delimiters and MDX expression delimiters in prose", () => {
  const contract = readContract();
  contract.tools[0].description = "Pipe | value with {synthetic} text.";
  const source = renderCatalog(contract);
  assert.match(source, /Pipe \\| value with &#123;synthetic&#125; text\./);
  assert.doesNotMatch(source, /\{synthetic\}/);
});

test("renderers reject active markup and unsafe prose URLs", () => {
  for (const value of [
    "Safe-looking text <script>alert(1)</script>",
    "Read [this](javascript:alert(1))."
  ]) {
    const contract = readContract();
    contract.tools[0].description = value;
    assert.throws(() => renderCatalog(contract), /unsafe contract prose/i);
    assert.throws(() => renderPublicManifest(contract), /unsafe contract prose/i);
  }
});

test("pure renderers are deterministic and do not mutate deeply frozen input", () => {
  const contract = deepFreeze(readContract());
  const before = JSON.stringify(contract);
  const firstCatalog = renderCatalog(contract);
  const firstManifest = renderPublicManifest(contract);

  assert.equal(renderCatalog(contract), firstCatalog);
  assert.equal(renderPublicManifest(contract), firstManifest);
  assert.equal(JSON.stringify(contract), before);
});

test("check mode rejects missing and byte-stale outputs and accepts exact bytes", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");

    await assert.rejects(
      run(["--check", "--catalog", catalogPath, "--public", publicPath]),
      /MCP catalog output is missing/
    );
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, "stale\n");
    await assert.rejects(
      run(["--check", "--catalog", catalogPath, "--public", publicPath]),
      /public MCP manifest is stale/
    );
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    await assert.doesNotReject(run(["--check", "--catalog", catalogPath, "--public", publicPath]));
  });
});

test("write mode creates exact files atomically and repeated writes are byte-idempotent", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");

    await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
    assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
    assertNoTransactionFiles(directory);

    const beforeCatalog = readFileSync(catalogPath);
    const beforePublic = readFileSync(publicPath);
    await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
    assert.deepEqual(readFileSync(catalogPath), beforeCatalog);
    assert.deepEqual(readFileSync(publicPath), beforePublic);
    assertNoTransactionFiles(directory);
  });
});

test("write mode rejects outputs swapped to symlinks during rendering before exact-byte return", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const victimCatalogPath = join(directory, "victim-tools.mdx");
    const victimPublicPath = join(directory, "victim-mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    writeFileSync(victimCatalogPath, renderCatalog(readContract()));
    writeFileSync(victimPublicPath, renderPublicManifest(readContract()));

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        renderPublicManifestImpl(contract) {
          rmSync(catalogPath);
          rmSync(publicPath);
          symlinkSync(victimCatalogPath, catalogPath);
          symlinkSync(victimPublicPath, publicPath);
          return renderPublicManifest(contract);
        }
      }),
      /unsafe .*output target.*symbolic links/i
    );
    assert.equal(lstatSync(catalogPath).isSymbolicLink(), true);
    assert.equal(lstatSync(publicPath).isSymbolicLink(), true);
  });
});

test("a later writer recovers crash-interrupted backup, install, and cleanup phases", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const phase of ["initial-journal-write", "backup", "first-install", "second-install", "cleanup"]) {
      const phaseDirectory = join(directory, phase);
      mkdirSync(phaseDirectory);
      const catalogPath = join(phaseDirectory, "tools.mdx");
      const publicPath = join(phaseDirectory, "mcp-tools.json");
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");

      const crashed = crashWriterAt(phase, catalogPath, publicPath);
      assert.equal(crashed.signal, "SIGKILL", `${phase}: ${crashed.stderr}`);
      assert.ok(
        readdirSync(phaseDirectory).some((name) => name.includes(".mcp-pair-transaction.json")),
        `${phase} must leave a recovery journal`
      );

      await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
      assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()), phase);
      assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()), phase);
      assertNoTransactionFiles(phaseDirectory);
    }
  });
});

test("a later writer cleans one complete temporary pair left before journal publication", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    const crashed = crashWriterAt("temporary-files", catalogPath, publicPath);
    assert.equal(crashed.signal, "SIGKILL", crashed.stderr);
    assert.equal(transactionFiles(directory, ".tmp").length, 2);
    assert.equal(readdirSync(directory).some((name) => name.includes(".mcp-pair-transaction.json")), false);

    await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
    assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
    assertNoTransactionFiles(directory);
  });
});

test("a concurrent writer cannot reclaim live pre-journal temporary files or lose installed outputs", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const first = spawn(
      process.execPath,
      ["--input-type=module", "--eval", writerChildSource(catalogPath, publicPath, { pauseAtTemporaryFiles: true })],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const firstStdout = { value: "" };
    const firstStderr = { value: "" };
    first.stdout.setEncoding("utf8");
    first.stderr.setEncoding("utf8");
    first.stdout.on("data", (chunk) => { firstStdout.value += chunk; });
    first.stderr.on("data", (chunk) => { firstStderr.value += chunk; });

    try {
      await waitForChildOutput(first, "READY\n", firstStdout);
      const beforeCheck = readdirSync(directory).sort();
      await assert.rejects(
        run(["--check", "--catalog", catalogPath, "--public", publicPath]),
        /writer lock/i
      );
      assert.deepEqual(readdirSync(directory).sort(), beforeCheck);
      const second = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", writerChildSource(catalogPath, publicPath)],
        { encoding: "utf8", timeout: 10_000 }
      );
      first.stdin.end("resume\n");
      const firstResult = await waitForChildExit(first, firstStdout, firstStderr);

      assert.equal(second.status, 2, `second writer unexpectedly succeeded: ${second.stdout}\n${second.stderr}`);
      assert.match(second.stdout, /GeneratedPairWriterLockError:.*writer.*active/i);
      assert.deepEqual(firstResult, { code: 0, signal: null, stdout: "READY\nOK\n", stderr: "" });
      assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
      assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
      assertNoTransactionFiles(directory);
    } finally {
      if (first.exitCode === null && first.signalCode === null) {
        first.stdin.end("resume\n");
        first.kill("SIGKILL");
      }
    }
  });
});

test("overlapping output pairs serialize on every target regardless of target role or order", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const variant of ["shared-public", "reversed-role"]) {
      const variantDirectory = join(directory, variant);
      mkdirSync(variantDirectory);
      const sharedPath = join(variantDirectory, "shared-output");
      const aOnlyPath = join(variantDirectory, "a-only-output");
      const bOnlyPath = join(variantDirectory, "b-only-output");
      const aContractPath = join(variantDirectory, "contract-a.json");
      const bContractPath = join(variantDirectory, "contract-b.json");
      const contractA = readContract();
      const contractB = readContract();
      contractA.sourceSha = "a".repeat(40);
      contractB.sourceSha = "b".repeat(40);
      writeFileSync(aContractPath, JSON.stringify(contractA));
      writeFileSync(bContractPath, JSON.stringify(contractB));
      const [aCatalogPath, aPublicPath] = variant === "shared-public"
        ? [aOnlyPath, sharedPath]
        : [sharedPath, aOnlyPath];
      const [bCatalogPath, bPublicPath] = [bOnlyPath, sharedPath];
      const first = spawn(
        process.execPath,
        ["--input-type=module", "--eval", writerChildSource(aCatalogPath, aPublicPath, {
          contractPath: aContractPath,
          pauseAtWriterLockPhase: "lock-published"
        })],
        { stdio: ["pipe", "pipe", "pipe"] }
      );
      const firstStdout = { value: "" };
      const firstStderr = { value: "" };
      first.stdout.setEncoding("utf8");
      first.stderr.setEncoding("utf8");
      first.stdout.on("data", (chunk) => { firstStdout.value += chunk; });
      first.stderr.on("data", (chunk) => { firstStderr.value += chunk; });

      try {
        await waitForChildOutput(first, "READY\n", firstStdout);
        const contender = spawnSync(
          process.execPath,
          ["--input-type=module", "--eval", writerChildSource(bCatalogPath, bPublicPath, {
            contractPath: bContractPath
          })],
          { encoding: "utf8", timeout: 10_000 }
        );
        assert.equal(contender.status, 2, `${variant}: contender unexpectedly succeeded: ${contender.stdout}\n${contender.stderr}`);
        assert.match(contender.stdout, /GeneratedPairWriterLockError:.*writer.*active/i, variant);

        first.stdin.end("resume\n");
        const firstResult = await waitForChildExit(first, firstStdout, firstStderr);
        assert.deepEqual(firstResult, { code: 0, signal: null, stdout: "READY\nOK\n", stderr: "" }, variant);

        await run([
          "--write",
          "--contract",
          bContractPath,
          "--catalog",
          bCatalogPath,
          "--public",
          bPublicPath
        ]);
        await assert.doesNotReject(run([
          "--check",
          "--contract",
          bContractPath,
          "--catalog",
          bCatalogPath,
          "--public",
          bPublicPath
        ]));
        assert.equal(JSON.parse(readFileSync(sharedPath, "utf8")).sourceSha, contractB.sourceSha, variant);
        assertNoTransactionFiles(variantDirectory);
      } finally {
        if (first.exitCode === null && first.signalCode === null) {
          first.stdin.end("resume\n");
          first.kill("SIGKILL");
        }
      }
    }
  });
});

test("a live writer lock candidate blocks another writer without being reclaimed", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const first = spawn(
      process.execPath,
      ["--input-type=module", "--eval", writerChildSource(catalogPath, publicPath, {
        pauseAtWriterLockPhase: "lock-candidate"
      })],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const firstStdout = { value: "" };
    const firstStderr = { value: "" };
    first.stdout.setEncoding("utf8");
    first.stderr.setEncoding("utf8");
    first.stdout.on("data", (chunk) => { firstStdout.value += chunk; });
    first.stderr.on("data", (chunk) => { firstStderr.value += chunk; });

    try {
      await waitForChildOutput(first, "READY\n", firstStdout);
      const before = readdirSync(directory).sort();
      const second = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", writerChildSource(catalogPath, publicPath)],
        { encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(second.status, 2, `second writer unexpectedly succeeded: ${second.stdout}\n${second.stderr}`);
      assert.match(second.stdout, /GeneratedPairWriterLockError:.*writer.*active/i);
      assert.deepEqual(readdirSync(directory).sort(), before);

      first.stdin.end("resume\n");
      const firstResult = await waitForChildExit(first, firstStdout, firstStderr);
      assert.deepEqual(firstResult, { code: 0, signal: null, stdout: "READY\nOK\n", stderr: "" });
      assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
      assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
      assertNoTransactionFiles(directory);
    } finally {
      if (first.exitCode === null && first.signalCode === null) {
        first.stdin.end("resume\n");
        first.kill("SIGKILL");
      }
    }
  });
});

test("a later writer recovers crashes at lock candidate, publication, and stale quarantine", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const phase of ["lock-candidate", "lock-published"]) {
      const phaseDirectory = join(directory, phase);
      mkdirSync(phaseDirectory);
      const catalogPath = join(phaseDirectory, "tools.mdx");
      const publicPath = join(phaseDirectory, "mcp-tools.json");
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");

      const crashed = crashWriterAt(phase, catalogPath, publicPath);
      assert.equal(crashed.signal, "SIGKILL", `${phase}: ${crashed.stderr}`);
      assert.ok(readdirSync(phaseDirectory).some((name) => name.includes(".mcp-pair-write.lock")));

      await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
      assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
      assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
      assertNoTransactionFiles(phaseDirectory);
    }

    for (const phase of ["lock-stale-linked", "lock-stale-quarantine"]) {
      const staleDirectory = join(directory, phase);
      mkdirSync(staleDirectory);
      const catalogPath = join(staleDirectory, "tools.mdx");
      const publicPath = join(staleDirectory, "mcp-tools.json");
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");
      const publishedCrash = crashWriterAt("lock-published", catalogPath, publicPath);
      assert.equal(publishedCrash.signal, "SIGKILL", `${phase}: ${publishedCrash.stderr}`);
      const quarantineCrash = crashWriterAt(phase, catalogPath, publicPath);
      assert.equal(quarantineCrash.signal, "SIGKILL", `${phase}: ${quarantineCrash.stderr}`);
      assert.ok(readdirSync(staleDirectory).some((name) => name.endsWith(".stale")));

      await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
      assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
      assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
      assertNoTransactionFiles(staleDirectory);
    }
  });
});

test("a lock winner discovers stale evidence published after its pre-acquisition scan", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const staleToken = "999999999.123.deadbeef";
    const currentToken = `${process.pid}.456.cafebabe`;
    const stalePath = `${lockPath}.${staleToken}.stale`;
    writeFileSync(lockPath, `${JSON.stringify({
      version: 2,
      token: staleToken,
      pid: 999999999,
      processIncarnation: "dead-process-incarnation",
      targetPaths: [catalogPath, publicPath]
    }, null, 2)}\n`);
    let linked = false;

    const lock = acquireGeneratedPairWriterLock(
      [catalogPath, publicPath],
      currentToken,
      {
        ...fileSystem,
        linkSync(source, destination) {
          if (!linked) {
            linked = true;
            renameSync(lockPath, stalePath);
          }
          return fileSystem.linkSync(source, destination);
        }
      }
    );
    try {
      assert.deepEqual([...lock.recoverableTransactionTokens], [staleToken]);
      finishGeneratedPairWriterLockRecovery(lock, fileSystem);
      assert.equal(existsSync(stalePath), false);
    } finally {
      releaseGeneratedPairWriterLock(lock, fileSystem);
    }
    assertNoTransactionFiles(directory);
  });
});

test("a reused PID with a mismatched process incarnation permits safe stale-lock recovery", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const staleToken = `${process.pid}.111.deadbeef`;
    const currentToken = `${process.pid}.222.cafebabe`;
    const targetPaths = [catalogPath, publicPath];
    writeFileSync(lockPath, `${JSON.stringify({
      version: 2,
      token: staleToken,
      pid: process.pid,
      processIncarnation: "prior-process-incarnation",
      targetPaths
    }, null, 2)}\n`);

    const lock = acquireGeneratedPairWriterLock(targetPaths, currentToken, fileSystem, {
      processIncarnationForPid() {
        return "current-process-incarnation";
      }
    });
    try {
      assert.deepEqual([...lock.recoverableTransactionTokens], [staleToken]);
      finishGeneratedPairWriterLockRecovery(lock, fileSystem);
    } finally {
      releaseGeneratedPairWriterLock(lock, fileSystem);
    }
    assertNoTransactionFiles(directory);
  });
});

test("a genuine live owner with the same process incarnation is never reclaimed", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const ownerToken = `${process.pid}.333.deadbeef`;
    const contenderToken = `${process.pid}.444.cafebabe`;
    const targetPaths = [catalogPath, publicPath];
    writeFileSync(lockPath, `${JSON.stringify({
      version: 2,
      token: ownerToken,
      pid: process.pid,
      processIncarnation: "same-live-incarnation",
      targetPaths
    }, null, 2)}\n`);

    assert.throws(
      () => acquireGeneratedPairWriterLock(targetPaths, contenderToken, fileSystem, {
        processIncarnationForPid() {
          return "same-live-incarnation";
        }
      }),
      /writer.*active|live.*owner/i
    );
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, ownerToken);
  });
});

test("an uncertain process-incarnation lookup fails closed without reclaiming the owner", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const ownerToken = `${process.pid}.555.deadbeef`;
    const contenderToken = `${process.pid}.666.cafebabe`;
    const targetPaths = [catalogPath, publicPath];
    writeFileSync(lockPath, `${JSON.stringify({
      version: 2,
      token: ownerToken,
      pid: process.pid,
      processIncarnation: "recorded-owner-incarnation",
      targetPaths
    }, null, 2)}\n`);
    let lookups = 0;

    assert.throws(
      () => acquireGeneratedPairWriterLock(targetPaths, contenderToken, fileSystem, {
        processIncarnationForPid() {
          lookups += 1;
          return lookups === 1 ? "contender-incarnation" : null;
        }
      }),
      /ownership is unknown|incarnation could not be established/i
    );
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, ownerToken);
  });
});

test("writer fails closed on an unknown target-derived lock artifact", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const unknownPath = `${catalogPath}.mcp-pair-write.lock.unrecognized`;
    writeFileSync(unknownPath, "unknown lock evidence\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /writer lock recovery.*unsafe.*artifact/i
    );
    assert.equal(readFileSync(unknownPath, "utf8"), "unknown lock evidence\n");
    assert.equal(existsSync(catalogPath), false);
    assert.equal(existsSync(publicPath), false);
  });
});

test("stale-lock quarantine captures a companion candidate created after the pre-scan", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const staleToken = "999999999.123.deadbeef";
    const currentToken = `${process.pid}.456.cafebabe`;
    const staleCandidatePath = `${lockPath}.${staleToken}.candidate`;
    const targetPaths = [catalogPath, publicPath];
    writeFileSync(lockPath, `${JSON.stringify({
      version: 2,
      token: staleToken,
      pid: 999999999,
      processIncarnation: "dead-process-incarnation",
      targetPaths
    }, null, 2)}\n`);
    let candidatePublished = false;

    const lock = acquireGeneratedPairWriterLock(targetPaths, currentToken, {
      ...fileSystem,
      linkSync(source, destination) {
        if (source === lockPath && destination.endsWith(`.${staleToken}.stale`) && !candidatePublished) {
          candidatePublished = true;
          fileSystem.linkSync(lockPath, staleCandidatePath);
        }
        return fileSystem.linkSync(source, destination);
      }
    });
    try {
      assert.equal(lock.recoveryArtifacts.some(({ path }) => path === staleCandidatePath), true);
      finishGeneratedPairWriterLockRecovery(lock, fileSystem);
      assert.equal(existsSync(staleCandidatePath), false);
    } finally {
      releaseGeneratedPairWriterLock(lock, fileSystem);
    }
    assertNoTransactionFiles(directory);
  });
});

test("stale-lock quarantine cannot overwrite or move a contender's live canonical lock", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const staleToken = "999999999.123.deadbeef";
    const contenderToken = `${process.pid}.456.cafebabe`;
    const writerToken = `${process.pid}.789.facefeed`;
    const stalePath = `${lockPath}.${staleToken}.stale`;
    const contenderCandidatePath = `${lockPath}.${contenderToken}.candidate`;
    const targetPaths = [catalogPath, publicPath];
    const record = (token, pid) => `${JSON.stringify({
      version: 2,
      token,
      pid,
      processIncarnation: pid === process.pid ? "live-process-incarnation" : "dead-process-incarnation",
      targetPaths
    }, null, 2)}\n`;
    writeFileSync(lockPath, record(staleToken, 999999999));
    let interposed = false;

    const interposeContender = () => {
      if (interposed) return;
      interposed = true;
      fileSystem.linkSync(lockPath, stalePath);
      fileSystem.unlinkSync(lockPath);
      writeFileSync(contenderCandidatePath, record(contenderToken, process.pid));
      fileSystem.linkSync(contenderCandidatePath, lockPath);
    };
    const io = {
      ...fileSystem,
      linkSync(source, destination) {
        if (source === lockPath && destination === stalePath) interposeContender();
        return fileSystem.linkSync(source, destination);
      },
      renameSync(source, destination) {
        if (source === lockPath && destination === stalePath) {
          renameSync(source, destination);
          writeFileSync(contenderCandidatePath, record(contenderToken, process.pid));
          fileSystem.linkSync(contenderCandidatePath, lockPath);
        }
        return renameSync(source, destination);
      }
    };

    assert.throws(
      () => acquireGeneratedPairWriterLock(targetPaths, writerToken, io),
      /ownership changed|identity changed|active/i
    );
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, contenderToken);
    assert.equal(JSON.parse(readFileSync(stalePath, "utf8")).token, staleToken);
    assert.equal(existsSync(contenderCandidatePath), true);
  });
});

test("a supplied writer lock must still own the exact canonical inode and targets", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const transactionToken = `${process.pid}.123.deadbeef`;
    const lock = acquireGeneratedPairWriterLock(
      [catalogPath, publicPath],
      transactionToken,
      fileSystem
    );
    fileSystem.unlinkSync(lock.lockPath);

    assert.throws(
      () => writeGeneratedPair([
        { targetPath: catalogPath, contents: "new catalog\n" },
        { targetPath: publicPath, contents: "new public\n" }
      ], { io: fileSystem, transactionToken, writerLock: lock }),
      /writer lock.*missing|missing.*writer lock/i
    );
    assert.equal(existsSync(catalogPath), false);
    assert.equal(existsSync(publicPath), false);
    assert.throws(
      () => releaseGeneratedPairWriterLock(lock, fileSystem),
      /writer lock.*missing|missing.*writer lock/i
    );
  });
});

test("a supplied writer lock rejects in-place metadata rewritten to a foreign PID", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const transactionToken = `${process.pid}.124.cafebabe`;
    const targetPaths = [catalogPath, publicPath];
    const lock = acquireGeneratedPairWriterLock(targetPaths, transactionToken, fileSystem);
    writeFileSync(lock.lockPath, `${JSON.stringify({
      version: 2,
      token: transactionToken,
      pid: process.pid + 1,
      processIncarnation: lock.processIncarnation,
      targetPaths
    }, null, 2)}\n`);

    assert.throws(
      () => writeGeneratedPair([
        { targetPath: catalogPath, contents: "new catalog\n" },
        { targetPath: publicPath, contents: "new public\n" }
      ], { io: fileSystem, transactionToken, writerLock: lock }),
      /writer lock.*PID|PID.*writer lock/i
    );
    assert.equal(existsSync(catalogPath), false);
    assert.equal(existsSync(publicPath), false);
  });
});

test("writer lock reads detect canonical inode replacement before backup mutation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const catalogLockPath = `${catalogPath}.mcp-pair-write.lock`;
    const displacedLockPath = join(directory, "displaced-owner-lock");
    const foreignToken = `${process.pid}.999.feedface`;
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    let armed = false;
    let replaced = false;

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase === "journal") armed = true;
        },
        fsImpl: {
          readFileSync(path, options) {
            if (armed && path === catalogLockPath && !replaced) {
              replaced = true;
              const ownerBytes = fileSystem.readFileSync(path, options);
              const foreignRecord = { ...JSON.parse(String(ownerBytes)), token: foreignToken };
              renameSync(path, displacedLockPath);
              writeFileSync(path, `${JSON.stringify(foreignRecord, null, 2)}\n`);
              return ownerBytes;
            }
            return fileSystem.readFileSync(path, options);
          }
        }
      }),
      /writer lock.*identity changed|identity changed.*writer lock|rollback was not attempted/i
    );
    assert.equal(replaced, true);
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
    assert.equal(JSON.parse(readFileSync(catalogLockPath, "utf8")).token, foreignToken);
    assert.equal(existsSync(displacedLockPath), true);
  });
});

test("a writer that loses one target lock cannot overwrite a completed overlapping contender", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const contenderPublicPath = join(directory, "contender-mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    let contender;

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        renderPublicManifestImpl(contract) {
          fileSystem.unlinkSync(lockPath);
          contender = spawnSync(
            process.execPath,
            ["--input-type=module", "--eval", writerChildSource(catalogPath, contenderPublicPath)],
            { encoding: "utf8", timeout: 10_000 }
          );
          return renderPublicManifest(contract);
        }
      }),
      /writer lock.*(?:missing|release was incomplete)|missing.*writer lock/i
    );
    assert.equal(contender.status, 0, `${contender.stdout}\n${contender.stderr}`);
    assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(existsSync(publicPath), false);
    assert.equal(readFileSync(contenderPublicPath, "utf8"), renderPublicManifest(readContract()));
    assertNoTransactionFiles(directory);
  });
});

test("post-install rollback preserves a replacement output it did not install", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase !== "first-install") return;
          rmSync(catalogPath);
          writeFileSync(catalogPath, "foreign catalog\n");
          throw new Error("post-install replacement");
        }
      }),
      /post-install replacement.*rollback was incomplete|rollback.*does not match.*transaction/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), "foreign catalog\n");
    assert.equal(existsSync(publicPath), false);
    assert.ok(readdirSync(directory).some((name) => name.includes(".mcp-pair-transaction.json")));
  });
});

test("pre-backup rollback preserves a replaced original and all transaction evidence", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase !== "journal") return;
          rmSync(publicPath);
          writeFileSync(publicPath, "foreign public\n");
          throw new Error("pre-backup replacement");
        }
      }),
      /pre-backup replacement.*rollback was incomplete|original output identity.*does not match/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "foreign public\n");
    assert.equal(transactionFiles(directory, ".tmp").length, 2);
    assert.equal(transactionFiles(directory, ".bak").length, 0);
    assert.ok(readdirSync(directory).some((name) => name.includes(".mcp-pair-transaction.json")));
  });
});

test("persisted transaction does not recover after losing its canonical writer lock", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const lockPath = `${catalogPath}.mcp-pair-write.lock`;
    const targetPaths = [catalogPath, publicPath];
    const foreignToken = `${process.pid}.999.feedface`;
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase !== "journal") return;
          rmSync(lockPath);
          writeFileSync(lockPath, `${JSON.stringify({
            version: 2,
            token: foreignToken,
            pid: process.pid,
            processIncarnation: "foreign-process-incarnation",
            targetPaths
          }, null, 2)}\n`);
          throw new Error("lost lock after journal");
        }
      }),
      /lost lock after journal.*(?:lock|ownership)|rollback was not attempted/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
    assert.equal(transactionFiles(directory, ".tmp").length, 2);
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, foreignToken);
    assert.ok(readdirSync(directory).some((name) => name.includes(".mcp-pair-transaction.json")));
  });
});

test("committed journal replacement is preserved before backup cleanup", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase !== "second-install") return;
          rmSync(journalPath);
          writeFileSync(journalPath, "foreign committed journal\n");
        }
      }),
      /journal.*identity|journal.*ownership/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
    assert.equal(readFileSync(journalPath, "utf8"), "foreign committed journal\n");
    assert.equal(transactionFiles(directory, ".bak").length, 2);
  });
});

test("writer revalidates installed output identity after phase hooks before committing", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        transactionPhaseHook(phase) {
          if (phase !== "first-install") return;
          rmSync(catalogPath);
          writeFileSync(catalogPath, "foreign catalog\n");
        }
      }),
      /installed transaction output identity.*does not match|does not belong to.*transaction/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), "foreign catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
    assert.ok(readdirSync(directory).some((name) => name.includes(".mcp-pair-transaction.json")));
  });
});

test("pre-journal recovery preserves and refuses ambiguous temporary artifacts", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const catalogTemporaryPath = `${catalogPath}.123.456.aaaa.tmp`;
    const publicTemporaryPath = `${publicPath}.123.456.bbbb.tmp`;
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(catalogTemporaryPath, "catalog orphan\n");
    writeFileSync(publicTemporaryPath, "public orphan\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /ambiguous.*temporary artifacts/i
    );
    assert.equal(readFileSync(catalogTemporaryPath, "utf8"), "catalog orphan\n");
    assert.equal(readFileSync(publicTemporaryPath, "utf8"), "public orphan\n");
  });
});

test("pre-journal recovery preserves a sole temporary artifact with unprovable ownership", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const soleTemporaryPath = `${catalogPath}.123.456.aaaa.tmp`;
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(soleTemporaryPath, "sole orphan\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /ambiguous.*temporary artifacts/i
    );
    assert.equal(readFileSync(soleTemporaryPath, "utf8"), "sole orphan\n");
  });
});

test("pre-journal cleanup preserves a temporary file replaced during ownership validation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "999999999.123.deadbeef";
    const catalogTemporaryPath = `${catalogPath}.${token}.tmp`;
    const publicTemporaryPath = `${publicPath}.${token}.tmp`;
    writeFileSync(catalogTemporaryPath, "original catalog temporary\n");
    writeFileSync(publicTemporaryPath, "original public temporary\n");
    let swapped = false;

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], {
        ...fileSystem,
        lstatSync(path) {
          if (path === publicTemporaryPath && !swapped) {
            swapped = true;
            rmSync(catalogTemporaryPath);
            writeFileSync(catalogTemporaryPath, "foreign catalog temporary\n");
          }
          return lstatSync(path);
        }
      }, { recoverableTransactionTokens: new Set([token]) }),
      /temporary file ownership changed|temporary cleanup failed/i
    );
    assert.equal(readFileSync(catalogTemporaryPath, "utf8"), "foreign catalog temporary\n");
    assert.equal(readFileSync(publicTemporaryPath, "utf8"), "original public temporary\n");
  });
});

test("staged-journal cleanup preserves files replaced during ownership validation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "999999999.123.deadbeef";
    const stagePath = `${catalogPath}.mcp-pair-transaction.json.${token}.stage`;
    const catalogTemporaryPath = `${catalogPath}.${token}.tmp`;
    const publicTemporaryPath = `${publicPath}.${token}.tmp`;
    writeFileSync(stagePath, "staged journal\n");
    writeFileSync(catalogTemporaryPath, "original catalog temporary\n");
    writeFileSync(publicTemporaryPath, "original public temporary\n");
    let swapped = false;

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], {
        ...fileSystem,
        lstatSync(path) {
          if (path === publicTemporaryPath && !swapped) {
            swapped = true;
            rmSync(catalogTemporaryPath);
            writeFileSync(catalogTemporaryPath, "foreign staged temporary\n");
          }
          return lstatSync(path);
        }
      }, { recoverableTransactionTokens: new Set([token]) }),
      /temporary file ownership changed|staged journal was preserved/i
    );
    assert.equal(readFileSync(catalogTemporaryPath, "utf8"), "foreign staged temporary\n");
    assert.equal(readFileSync(publicTemporaryPath, "utf8"), "original public temporary\n");
    assert.equal(readFileSync(stagePath, "utf8"), "staged journal\n");
  });
});

test("check mode fails closed without mutating an incomplete transaction journal", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(journalPath, "incomplete transaction\n");
    const before = readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]);

    await assert.rejects(
      run(["--check", "--catalog", catalogPath, "--public", publicPath]),
      /incomplete MCP output transaction/i
    );
    assert.deepEqual(
      readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]),
      before
    );
  });
});

test("check mode fails closed on a public-only transaction artifact without mutating it", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const publicTemporaryPath = `${publicPath}.123.456.deadbeef.tmp`;
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(publicTemporaryPath, "public orphan\n");

    await assert.rejects(
      run(["--check", "--catalog", catalogPath, "--public", publicPath]),
      /incomplete MCP output transaction/i
    );
    assert.equal(readFileSync(publicTemporaryPath, "utf8"), "public orphan\n");
  });
});

test("check and write reject a symlink writer lock without mutating it", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const mode of ["--check", "--write"]) {
      const modeDirectory = join(directory, mode.slice(2));
      mkdirSync(modeDirectory);
      const catalogPath = join(modeDirectory, "tools.mdx");
      const publicPath = join(modeDirectory, "mcp-tools.json");
      const lockPath = `${catalogPath}.mcp-pair-write.lock`;
      const victimPath = join(modeDirectory, "victim.txt");
      writeFileSync(catalogPath, renderCatalog(readContract()));
      writeFileSync(publicPath, renderPublicManifest(readContract()));
      writeFileSync(victimPath, "unrelated victim\n");
      symlinkSync(victimPath, lockPath);

      await assert.rejects(
        run([mode, "--catalog", catalogPath, "--public", publicPath]),
        /writer lock.*symbolic link|symbolic link.*writer lock/i
      );
      assert.equal(lstatSync(lockPath).isSymbolicLink(), true);
      assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    }
  });
});

test("journal recovery rejects traversal-shaped transaction tokens without touching unrelated files", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const victimTemporaryPath = join(directory, "victim.tmp");
    const victimBackupPath = join(directory, "victim.bak");
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(victimTemporaryPath, "unrelated temporary\n");
    writeFileSync(victimBackupPath, "unrelated backup\n");
    mkdirSync(`${catalogPath}.jump`);
    mkdirSync(`${publicPath}.jump`);
    const entries = [catalogPath, publicPath].map((targetPath) => ({
      targetPath,
      temporaryPath: `${targetPath}.jump/../victim.tmp`,
      backupPath: `${targetPath}.jump/../victim.bak`,
      hadTarget: true
    }));
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: true, entries }, null, 2)}\n`);

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /transaction journal.*(?:token|path).*unsafe|unsafe.*transaction journal/i
    );
    assert.equal(readFileSync(victimTemporaryPath, "utf8"), "unrelated temporary\n");
    assert.equal(readFileSync(victimBackupPath, "utf8"), "unrelated backup\n");
    assert.equal(existsSync(journalPath), true);
  });
});

test("journal recovery rejects symlink backups before installing either output", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const token = "123.456.deadbeef";
    const victimCatalogPath = join(directory, "victim-catalog.mdx");
    const victimPublicPath = join(directory, "victim-public.json");
    writeFileSync(victimCatalogPath, renderCatalog(readContract()));
    writeFileSync(victimPublicPath, renderPublicManifest(readContract()));
    const entries = [
      { targetPath: catalogPath, victimPath: victimCatalogPath },
      { targetPath: publicPath, victimPath: victimPublicPath }
    ].map(({ targetPath, victimPath }) => {
      const temporaryPath = `${targetPath}.${token}.tmp`;
      const backupPath = `${targetPath}.${token}.bak`;
      writeFileSync(temporaryPath, "new output\n");
      symlinkSync(victimPath, backupPath);
      return { targetPath, temporaryPath, backupPath, hadTarget: true };
    });
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: false, entries }, null, 2)}\n`);

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /backup.*(?:symbolic link|regular file)|(?:symbolic link|regular file).*backup/i
    );
    assert.equal(existsSync(catalogPath), false);
    assert.equal(existsSync(publicPath), false);
    assert.equal(entries.every(({ backupPath }) => lstatSync(backupPath).isSymbolicLink()), true);
    assert.equal(readFileSync(victimCatalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(readFileSync(victimPublicPath, "utf8"), renderPublicManifest(readContract()));
    assert.equal(existsSync(journalPath), true);
  });
});

test("journal recovery rejects installed output symlinks before cleanup", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const token = "123.456.deadbeef";
    const victimCatalogPath = join(directory, "victim-catalog.mdx");
    const victimPublicPath = join(directory, "victim-public.json");
    writeFileSync(victimCatalogPath, renderCatalog(readContract()));
    writeFileSync(victimPublicPath, renderPublicManifest(readContract()));
    symlinkSync(victimCatalogPath, catalogPath);
    symlinkSync(victimPublicPath, publicPath);
    const entries = [catalogPath, publicPath].map((targetPath) => {
      const temporaryPath = `${targetPath}.${token}.tmp`;
      const backupPath = `${targetPath}.${token}.bak`;
      writeFileSync(backupPath, "original output\n");
      return { targetPath, temporaryPath, backupPath, hadTarget: true };
    });
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: true, entries }, null, 2)}\n`);

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], fileSystem),
      /output.*(?:symbolic link|regular file)|(?:symbolic link|regular file).*output/i
    );
    assert.equal(lstatSync(catalogPath).isSymbolicLink(), true);
    assert.equal(lstatSync(publicPath).isSymbolicLink(), true);
    assert.equal(entries.every(({ backupPath }) => existsSync(backupPath)), true);
    assert.equal(existsSync(journalPath), true);
  });
});

test("uncommitted rollback preserves outputs not installed by the recorded transaction", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const token = "123.456.deadbeef";
    writeFileSync(catalogPath, "foreign catalog\n");
    writeFileSync(publicPath, "foreign public\n");
    const entries = [catalogPath, publicPath].map((targetPath) => ({
      targetPath,
      temporaryPath: `${targetPath}.${token}.tmp`,
      backupPath: `${targetPath}.${token}.bak`,
      hadTarget: false,
      temporaryIdentity: { device: "999999", inode: "999999" }
    }));
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: false, entries }, null, 2)}\n`);

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], fileSystem),
      /output identity.*does not match|does not belong to.*transaction/i
    );
    assert.equal(readFileSync(catalogPath, "utf8"), "foreign catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "foreign public\n");
    assert.equal(existsSync(journalPath), true);
  });
});

test("journal recovery preserves a replacement regular temporary file with a foreign identity", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const token = "123.456.deadbeef";
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    const entries = [catalogPath, publicPath].map((targetPath) => ({
      targetPath,
      temporaryPath: `${targetPath}.${token}.tmp`,
      backupPath: `${targetPath}.${token}.bak`,
      hadTarget: true,
      temporaryIdentity: { device: "999999", inode: "999999" }
    }));
    writeFileSync(entries[0].temporaryPath, "foreign temporary file\n");
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: false, entries }, null, 2)}\n`);

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], fileSystem),
      /temporary file identity.*does not match|temporary file.*does not belong/i
    );
    assert.equal(readFileSync(entries[0].temporaryPath, "utf8"), "foreign temporary file\n");
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
    assert.equal(existsSync(journalPath), true);
  });
});

test("committed recovery preserves a replacement regular backup with a foreign identity", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const token = "123.456.deadbeef";
    writeFileSync(catalogPath, "new catalog\n");
    writeFileSync(publicPath, "new public\n");
    const entries = [catalogPath, publicPath].map((targetPath) => {
      const stat = lstatSync(targetPath);
      return {
        targetPath,
        temporaryPath: `${targetPath}.${token}.tmp`,
        backupPath: `${targetPath}.${token}.bak`,
        hadTarget: true,
        temporaryIdentity: { device: String(stat.dev), inode: String(stat.ino) },
        originalIdentity: { device: "999999", inode: "999999" }
      };
    });
    writeFileSync(entries[0].backupPath, "foreign backup file\n");
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: true, entries }, null, 2)}\n`);

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], fileSystem),
      /backup identity.*does not match|backup.*does not belong/i
    );
    assert.equal(readFileSync(entries[0].backupPath, "utf8"), "foreign backup file\n");
    assert.equal(readFileSync(catalogPath, "utf8"), "new catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "new public\n");
    assert.equal(existsSync(journalPath), true);
  });
});

test("staged-journal recovery rejects temporary symlinks before cleanup", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "123.456.deadbeef";
    const stagePath = `${catalogPath}.mcp-pair-transaction.json.${token}.stage`;
    const catalogTemporaryPath = `${catalogPath}.${token}.tmp`;
    const publicTemporaryPath = `${publicPath}.${token}.tmp`;
    const victimPath = join(directory, "victim.txt");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    writeFileSync(victimPath, "unrelated victim\n");
    symlinkSync(victimPath, catalogTemporaryPath);
    writeFileSync(publicTemporaryPath, "temporary public\n");
    writeFileSync(stagePath, "partial staged journal\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /temporary file.*symbolic link|symbolic link.*temporary file/i
    );
    assert.equal(lstatSync(catalogTemporaryPath).isSymbolicLink(), true);
    assert.equal(readFileSync(publicTemporaryPath, "utf8"), "temporary public\n");
    assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    assert.equal(existsSync(stagePath), true);
  });
});

test("staged-journal recovery preserves sole and mismatched temporary evidence", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const variant of ["sole", "mismatched"]) {
      const phaseDirectory = join(directory, variant);
      mkdirSync(phaseDirectory);
      const catalogPath = join(phaseDirectory, "tools.mdx");
      const publicPath = join(phaseDirectory, "mcp-tools.json");
      const token = "123.456.deadbeef";
      const stagePath = `${catalogPath}.mcp-pair-transaction.json.${token}.stage`;
      const catalogTemporaryPath = `${catalogPath}.${token}.tmp`;
      const publicTemporaryPath = variant === "sole"
        ? null
        : `${publicPath}.123.456.cafebabe.tmp`;
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");
      writeFileSync(stagePath, "partial staged journal\n");
      writeFileSync(catalogTemporaryPath, "temporary catalog\n");
      if (publicTemporaryPath) writeFileSync(publicTemporaryPath, "mismatched temporary public\n");

      await assert.rejects(
        run(["--write", "--catalog", catalogPath, "--public", publicPath]),
        /staged journal.*(?:incomplete|mismatched).*temporary|(?:incomplete|mismatched).*staged journal/i
      );
      assert.equal(readFileSync(stagePath, "utf8"), "partial staged journal\n");
      assert.equal(readFileSync(catalogTemporaryPath, "utf8"), "temporary catalog\n");
      if (publicTemporaryPath) {
        assert.equal(readFileSync(publicTemporaryPath, "utf8"), "mismatched temporary public\n");
      }
    }
  });
});

test("journal recovery rejects a symlink journal update before cleanup", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const journalPath = `${catalogPath}.mcp-pair-transaction.json`;
    const updatePath = `${journalPath}.next`;
    const token = "123.456.deadbeef";
    const victimPath = join(directory, "victim.txt");
    writeFileSync(catalogPath, renderCatalog(readContract()));
    writeFileSync(publicPath, renderPublicManifest(readContract()));
    writeFileSync(victimPath, "unrelated victim\n");
    symlinkSync(victimPath, updatePath);
    const entries = [catalogPath, publicPath].map((targetPath) => ({
      targetPath,
      temporaryPath: `${targetPath}.${token}.tmp`,
      backupPath: `${targetPath}.${token}.bak`,
      hadTarget: true
    }));
    writeFileSync(journalPath, `${JSON.stringify({ version: 1, committed: true, entries }, null, 2)}\n`);

    assert.throws(
      () => recoverGeneratedPair([catalogPath, publicPath], fileSystem),
      /journal update.*symbolic link|symbolic link.*journal update/i
    );
    assert.equal(lstatSync(updatePath).isSymbolicLink(), true);
    assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    assert.equal(existsSync(journalPath), true);
  });
});

test("journal recovery preserves a malformed foreign regular journal update and all transaction state", async () => {
  await inTemporaryDirectory(async (directory) => {
    const fixture = createUncommittedJournalFixture(directory);
    writeFileSync(fixture.updatePath, "foreign journal update\n");
    const before = snapshotRegularFiles([...fixture.transactionPaths, fixture.updatePath]);

    assert.throws(
      () => recoverGeneratedPair([fixture.catalogPath, fixture.publicPath], fileSystem),
      /journal update.*(?:valid JSON|successor|does not match)|recovery.*journal update/i
    );
    assert.deepEqual(snapshotRegularFiles([...fixture.transactionPaths, fixture.updatePath]), before);
  });
});

test("journal recovery preserves a mismatched committed journal update and all transaction state", async () => {
  await inTemporaryDirectory(async (directory) => {
    const fixture = createUncommittedJournalFixture(directory);
    const foreignToken = "123.456.cafebabe";
    const foreignEntries = [fixture.catalogPath, fixture.publicPath].map((targetPath, index) => ({
      targetPath,
      temporaryPath: `${targetPath}.${foreignToken}.tmp`,
      backupPath: `${targetPath}.${foreignToken}.bak`,
      hadTarget: index === 0,
      originalIdentity: index === 0 ? { device: "9001", inode: "9002" } : null,
      temporaryIdentity: { device: "9003", inode: String(9004 + index) }
    }));
    writeFileSync(
      fixture.updatePath,
      `${JSON.stringify({ version: 1, committed: true, entries: foreignEntries }, null, 2)}\n`
    );
    const before = snapshotRegularFiles([...fixture.transactionPaths, fixture.updatePath]);

    assert.throws(
      () => recoverGeneratedPair([fixture.catalogPath, fixture.publicPath], fileSystem),
      /journal update.*(?:successor|does not match)|recovery.*journal update/i
    );
    assert.deepEqual(snapshotRegularFiles([...fixture.transactionPaths, fixture.updatePath]), before);
  });
});

test("check and write reject an orphan symlink journal update without mutating it", async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const mode of ["--check", "--write"]) {
      const phaseDirectory = join(directory, mode.slice(2));
      mkdirSync(phaseDirectory);
      const catalogPath = join(phaseDirectory, "tools.mdx");
      const publicPath = join(phaseDirectory, "mcp-tools.json");
      const updatePath = `${catalogPath}.mcp-pair-transaction.json.next`;
      const victimPath = join(phaseDirectory, "victim.txt");
      writeFileSync(catalogPath, renderCatalog(readContract()));
      writeFileSync(publicPath, renderPublicManifest(readContract()));
      writeFileSync(victimPath, "unrelated victim\n");
      symlinkSync(victimPath, updatePath);

      await assert.rejects(
        run([mode, "--catalog", catalogPath, "--public", publicPath]),
        /journal update.*symbolic link|symbolic link.*journal update/i
      );
      assert.equal(lstatSync(updatePath).isSymbolicLink(), true);
      assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    }
  });
});

test("pre-journal writer cleanup preserves a colliding artifact it did not create", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "123.456.deadbeef";
    const plantedPath = `${publicPath}.${token}.tmp`;
    const victimPath = join(directory, "victim.txt");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    writeFileSync(victimPath, "unrelated victim\n");
    symlinkSync(victimPath, plantedPath);

    assert.throws(
      () => writeGeneratedPair([
        { targetPath: catalogPath, contents: "new catalog\n" },
        { targetPath: publicPath, contents: "new public\n" }
      ], { io: fileSystem, transactionToken: token }),
      /temporary file.*symbolic link|symbolic link.*temporary file/i
    );
    assert.equal(lstatSync(plantedPath).isSymbolicLink(), true);
    assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
  });
});

test("pre-journal writer cleanup preserves an artifact replaced after creation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "123.456.deadbeef";
    const replacedPath = `${publicPath}.${token}.tmp`;
    const victimPath = join(directory, "victim.txt");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    writeFileSync(victimPath, "unrelated victim\n");

    assert.throws(
      () => writeGeneratedPair([
        { targetPath: catalogPath, contents: "new catalog\n" },
        { targetPath: publicPath, contents: "new public\n" }
      ], {
        io: fileSystem,
        transactionToken: token,
        transactionPhaseHook(phase) {
          if (phase !== "temporary-files") return;
          rmSync(replacedPath);
          symlinkSync(victimPath, replacedPath);
          throw new Error("post-create hook failed");
        }
      }),
      (error) => error?.name === "GeneratedPairTransactionError" && /ownership.*cleanup/i.test(error.message)
    );
    assert.equal(lstatSync(replacedPath).isSymbolicLink(), true);
    assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    assert.equal(readFileSync(catalogPath, "utf8"), "old catalog\n");
    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
  });
});

test("journal-persisted recovery failure preserves a replaced temporary artifact", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    const token = "123.456.deadbeef";
    const replacedPath = `${publicPath}.${token}.tmp`;
    const victimPath = join(directory, "victim.txt");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    writeFileSync(victimPath, "unrelated victim\n");

    assert.throws(
      () => writeGeneratedPair([
        { targetPath: catalogPath, contents: "new catalog\n" },
        { targetPath: publicPath, contents: "new public\n" }
      ], {
        io: fileSystem,
        transactionPhaseHook(phase) {
          if (phase === "journal") {
            rmSync(replacedPath);
            symlinkSync(victimPath, replacedPath);
            throw new Error("journal durability failed");
          }
        },
        transactionToken: token
      }),
      (error) => error?.name === "GeneratedPairTransactionError" && /rollback.*incomplete/i.test(error.message)
    );
    assert.equal(lstatSync(replacedPath).isSymbolicLink(), true);
    assert.equal(readFileSync(victimPath, "utf8"), "unrelated victim\n");
    assert.equal(existsSync(`${catalogPath}.mcp-pair-transaction.json`), true);
  });
});

test("failed journal recovery preserves the only backup and journal", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    const crashed = crashWriterAt("backup", catalogPath, publicPath);
    assert.equal(crashed.signal, "SIGKILL", crashed.stderr);

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        fsImpl: {
          renameSync(source, destination) {
            if (source.endsWith(".bak") && destination === catalogPath) throw new Error("recovery restore failed");
            return renameSync(source, destination);
          }
        }
      }),
      (error) => error?.name === "GeneratedPairTransactionError" && /recovery.*incomplete/i.test(error.message)
    );

    const backups = transactionFiles(directory, ".bak");
    assert.ok(backups.length >= 1);
    assert.ok(backups.some((name) => readFileSync(join(directory, name), "utf8") === "old catalog\n"));
    assert.equal(transactionFiles(directory, ".mcp-pair-transaction.json").length, 1);
  });
});

test("every fsync fault point preserves a coherent pair recoverable by the next writer", async () => {
  await inTemporaryDirectory(async (directory) => {
    const expectedCatalog = renderCatalog(readContract());
    const expectedPublic = renderPublicManifest(readContract());
    const baselineDirectory = join(directory, "fsync-baseline");
    mkdirSync(baselineDirectory);
    const baselineCatalogPath = join(baselineDirectory, "tools.mdx");
    const baselinePublicPath = join(baselineDirectory, "mcp-tools.json");
    writeFileSync(baselineCatalogPath, "old catalog\n");
    writeFileSync(baselinePublicPath, "old public\n");
    let baselineFsyncCalls = 0;
    await run(["--write", "--catalog", baselineCatalogPath, "--public", baselinePublicPath], {
      fsImpl: {
        fsyncSync(descriptor) {
          baselineFsyncCalls += 1;
          return fsyncSync(descriptor);
        }
      }
    });
    assert.ok(baselineFsyncCalls > 0);
    assertNoTransactionFiles(baselineDirectory);

    for (let failureAt = 1; failureAt <= baselineFsyncCalls; failureAt += 1) {
      const phaseDirectory = join(directory, `fsync-${failureAt}`);
      mkdirSync(phaseDirectory);
      const catalogPath = join(phaseDirectory, "tools.mdx");
      const publicPath = join(phaseDirectory, "mcp-tools.json");
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");
      let fsyncCalls = 0;
      let faultInjected = false;

      await assert.rejects(
        run(["--write", "--catalog", catalogPath, "--public", publicPath], {
          fsImpl: {
            fsyncSync(descriptor) {
              fsyncCalls += 1;
              if (fsyncCalls === failureAt) {
                faultInjected = true;
                throw new Error(`fsync fault ${failureAt}`);
              }
              return fsyncSync(descriptor);
            }
          }
        }),
        new RegExp(`fsync fault ${failureAt}`)
      );
      assert.equal(faultInjected, true, `fsync ${failureAt} must be reached`);
      assert.ok(fsyncCalls >= failureAt);
      assert.equal(lstatSync(catalogPath).isFile(), true);
      assert.equal(lstatSync(publicPath).isFile(), true);
      const pair = [readFileSync(catalogPath, "utf8"), readFileSync(publicPath, "utf8")];
      assert.ok(
        (pair[0] === "old catalog\n" && pair[1] === "old public\n")
        || (pair[0] === expectedCatalog && pair[1] === expectedPublic),
        `fsync ${failureAt} must not leave a mixed pair`
      );

      await run(["--write", "--catalog", catalogPath, "--public", publicPath]);
      assert.equal(readFileSync(catalogPath, "utf8"), expectedCatalog);
      assert.equal(readFileSync(publicPath, "utf8"), expectedPublic);
      assertNoTransactionFiles(phaseDirectory);
    }
  });
});

test("render, write, and rename failures preserve both pre-existing targets and clean transaction files", async () => {
  for (const failure of ["render", "write", "rename"]) {
    await inTemporaryDirectory(async (directory) => {
      const catalogPath = join(directory, "tools.mdx");
      const publicPath = join(directory, "mcp-tools.json");
      writeFileSync(catalogPath, "old catalog\n");
      writeFileSync(publicPath, "old public\n");
      const beforeCatalog = readFileSync(catalogPath);
      const beforePublic = readFileSync(publicPath);
      let writeCalls = 0;
      const dependencies = failure === "render"
        ? { renderPublicManifestImpl() { throw new Error("render failed"); } }
        : failure === "write"
          ? {
              fsImpl: {
                writeFileSync(...args) {
                  writeCalls += 1;
                  if (writeCalls === 2) throw new Error("write failed");
                  return writeFileSync(...args);
                }
              }
            }
          : {
              fsImpl: {
                renameSync(source, destination) {
                  if (source.endsWith(".tmp") && destination === publicPath) throw new Error("rename failed");
                  return renameSync(source, destination);
                }
              }
            };

      await assert.rejects(
        run(["--write", "--catalog", catalogPath, "--public", publicPath], dependencies),
        new RegExp(`${failure} failed`)
      );
      assert.deepEqual(readFileSync(catalogPath), beforeCatalog, `${failure} preserves catalog`);
      assert.deepEqual(readFileSync(publicPath), beforePublic, `${failure} preserves public manifest`);
      assertNoTransactionFiles(directory);
    });
  }
});

test("backup-cleanup failure after commit keeps both installed outputs intact", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");
    let backupUnlinks = 0;

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        fsImpl: {
          unlinkSync(path) {
            if (path.endsWith(".bak")) {
              backupUnlinks += 1;
              if (backupUnlinks === 2) throw new Error("backup cleanup failed");
            }
            return rmSync(path);
          }
        }
      }),
      /backup cleanup failed/
    );

    assert.equal(readFileSync(catalogPath, "utf8"), renderCatalog(readContract()));
    assert.equal(readFileSync(publicPath, "utf8"), renderPublicManifest(readContract()));
    assert.deepEqual(transactionFiles(directory, ".tmp"), []);
    assert.equal(transactionFiles(directory, ".bak").length, 1);
  });
});

test("failed rollback restore preserves the original backup and reports incomplete recovery", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(catalogPath, "old catalog\n");
    writeFileSync(publicPath, "old public\n");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath], {
        fsImpl: {
          renameSync(source, destination) {
            if (source.endsWith(".tmp") && destination === publicPath) throw new Error("install failed");
            if (source.endsWith(".bak") && destination === catalogPath) throw new Error("restore failed");
            return renameSync(source, destination);
          }
        }
      }),
      /install failed.*rollback was incomplete/
    );

    assert.equal(readFileSync(publicPath, "utf8"), "old public\n");
    assert.equal(existsSync(catalogPath), true, "the installed catalog remains when its backup cannot be restored");
    const backups = transactionFiles(directory, ".bak");
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(directory, backups[0]), "utf8"), "old catalog\n");
    assert.deepEqual(transactionFiles(directory, ".tmp"), []);
  });
});

test("malformed arguments and identical or source-overwriting targets fail before file mutation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const contractPath = join(directory, "contract.json");
    const catalogPath = join(directory, "tools.mdx");
    const publicPath = join(directory, "mcp-tools.json");
    writeFileSync(contractPath, JSON.stringify(readContract()));
    writeFileSync(catalogPath, "catalog sentinel\n");
    writeFileSync(publicPath, "public sentinel\n");
    const before = [contractPath, catalogPath, publicPath].map((path) => readFileSync(path));
    const invalidArguments = [
      [],
      ["--write", "--check", "--catalog", catalogPath, "--public", publicPath],
      ["--wat"],
      ["--write", "trailing"],
      ["--write", "--catalog"],
      ["--write", "--catalog", "--public", publicPath],
      ["--write", "--catalog", catalogPath, "--catalog", catalogPath],
      ["--write", "--catalog", catalogPath, "--public", catalogPath],
      ["--write", "--contract", contractPath, "--catalog", contractPath, "--public", publicPath]
    ];

    for (const argv of invalidArguments) await assert.rejects(run(argv));
    assert.deepEqual([contractPath, catalogPath, publicPath].map((path) => readFileSync(path)), before);
    assertNoTransactionFiles(directory);
    assert.equal(existsSync(catalogPath), true);
    assert.equal(existsSync(publicPath), true);
  });
});

test("ancestor and descendant output targets fail before directory mutation", async () => {
  await inTemporaryDirectory(async (directory) => {
    const catalogPath = join(directory, "nested-output");
    const publicPath = join(catalogPath, "manifest.json");

    await assert.rejects(
      run(["--write", "--catalog", catalogPath, "--public", publicPath]),
      /unsafe output targets.*must not contain one another/i
    );

    assert.equal(existsSync(catalogPath), false);
    assertNoTransactionFiles(directory);
  });
});

test("outputs cannot occupy each other's reserved transaction namespaces in either direction", async () => {
  await inTemporaryDirectory(async (directory) => {
    const token = "123.456.deadbeef";
    const reservedPathsFor = (targetPath) => {
      const journalPath = `${targetPath}.mcp-pair-transaction.json`;
      const lockPath = `${targetPath}.mcp-pair-write.lock`;
      return [
        journalPath,
        `${journalPath}.next`,
        `${journalPath}.${token}.stage`,
        lockPath,
        `${lockPath}.${token}.candidate`,
        `${lockPath}.${token}.stale`,
        `${targetPath}.${token}.tmp`,
        `${targetPath}.${token}.bak`
      ];
    };

    for (const direction of ["catalog-primary", "public-primary"]) {
      const primaryName = `${direction}-primary`;
      const primaryPath = join(directory, primaryName);
      for (const [index] of reservedPathsFor(primaryPath).entries()) {
        const caseDirectory = join(directory, `${direction}-${index}`);
        mkdirSync(caseDirectory);
        const casePrimaryPath = join(caseDirectory, primaryName);
        const caseReservedPath = reservedPathsFor(casePrimaryPath)[index];
        const [catalogPath, publicPath] = direction === "catalog-primary"
          ? [casePrimaryPath, caseReservedPath]
          : [caseReservedPath, casePrimaryPath];

        await assert.rejects(
          run(["--write", "--catalog", catalogPath, "--public", publicPath]),
          /unsafe output targets.*reserved transaction namespace/i,
          `${direction} ${caseReservedPath}`
        );
        assert.deepEqual(readdirSync(caseDirectory), [], `${direction} ${caseReservedPath}`);
      }
    }
  });
});
