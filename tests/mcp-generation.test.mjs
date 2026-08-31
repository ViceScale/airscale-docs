import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  ExampleSynthesisError,
  renderCatalog,
  renderPublicManifest,
  run
} from "../scripts/build-mcp-catalog.mjs";

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
      name.endsWith(".tmp") || name.endsWith(".bak") || name.includes(".mcp-pair-transaction.json")
    )),
    []
  );
}

function transactionFiles(directory, suffix) {
  return readdirSync(directory).filter((name) => name.endsWith(suffix));
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
      }
    });
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" });
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
    const categoryIndex = source.indexOf(`# ${group.title}\n`);
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
    assert.equal(occurrences(source, `## \`${tool.name}\``), 1, `${tool.name} heading`);
  }
});

test("every tool block keeps purpose, label, metadata, top-level inputs, result behavior, and security visible", () => {
  const contract = readContract();
  const source = renderCatalog(contract);

  for (const [index, tool] of contract.tools.entries()) {
    const block = toolBlock(source, tool, contract.tools[index + 1]);
    const categoryTitle = CATEGORY_GROUPS.find(({ key }) => key === tool.category).title;
    assert.ok(block.indexOf(`<a id="${tool.anchor}"></a>`) < block.indexOf(`## \`${tool.name}\``));
    assert.match(block, /\*\*MCP tool\*\*/);
    assert.ok(block.includes(tool.description), `${tool.name} runtime description`);
    assert.ok(block.includes(`**Category:** ${categoryTitle}`), `${tool.name} category`);
    assert.ok(block.includes(`**Credit behavior:** ${tool.spend.summary}`), `${tool.name} spend`);
    assert.ok(block.includes(`**Execution:** ${tool.asynchronous ? "Asynchronous" : "Synchronous"}`));
    assert.match(block, /\*\*Authentication:\*\*[^\n]+never include an API key in tool arguments/i);
    assert.match(block, /### Inputs\n\n\| Field \| Type \| Required \| Description \| Constraints \|/);
    assert.match(block, /### Minimal `tools\/call` example/);
    assert.match(block, /### Expected result\n\n[^\n]+/);

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
