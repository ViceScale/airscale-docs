import assert from "node:assert/strict";
import {
  existsSync,
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

function inTemporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "airscale-mcp-catalog-"));
  return Promise.resolve()
    .then(() => callback(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }));
}

function assertNoTransactionFiles(directory) {
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.endsWith(".tmp") || name.endsWith(".bak")),
    []
  );
}

function transactionFiles(directory, suffix) {
  return readdirSync(directory).filter((name) => name.endsWith(suffix));
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
  }

  const serialized = JSON.stringify(examples);
  assert.doesNotMatch(serialized, /(?:api[_-]?key|authorization|bearer|password|secret|token)/i);
  assert.doesNotMatch(serialized, /(?:Prospeo|Icypeas|RapidAPI|Leadmagic|SalesQL|Limadata|ContactOut|Wiza|Forager|Bounceban|Findymail)/i);
  for (const value of serialized.match(/https?:\\?\/\\?\/[^"\\]+/g) ?? []) {
    if (/linkedin\.com/i.test(value)) assert.match(value, /example-person/);
    else assert.match(value, /example\.(?:com|org|net|test)/i);
  }

  const examplesByTool = new Map(examples.map((example) => [example.params.name, example.params.arguments]));
  assert.deepEqual(examplesByTool.get("airscale_find_people"), {
    query: { firstname: { include: ["example"] } }
  });
  assert.deepEqual(examplesByTool.get("airscale_add_contacts_to_enrichment_batch").contacts, [
    { custom_id: "example-custom-id" }
  ]);
});

test("rendered Markdown tables have exactly their declared columns and no trailing blank cell", () => {
  const source = renderCatalog(readContract());
  for (const line of source.split("\n").filter((candidate) => candidate.startsWith("|"))) {
    assert.doesNotMatch(line, /\| \|$/, line);
  }
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
