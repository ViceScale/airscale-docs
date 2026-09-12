import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";
import {
  assertBalancedCodeFences,
  assertLocalDocumentationLinksResolve,
  assertNoStaticCredentials
} from "./helpers/content-safety.mjs";

const contract = JSON.parse(readFileSync("contracts/cli.json", "utf8"));
const paths = ["cli/overview", "cli/commands"];
const pages = Object.fromEntries(paths.map((path) => [path, readFileSync(`${path}.mdx`, "utf8")]));
const optionNames = (option) => option.flags.match(/--[a-z][a-z-]*|-[A-Za-z]\b/g);
const globals = new Map(contract.globalOptions.flatMap((option) => optionNames(option).map((name) => [name, option])));

function bashCommands(source) {
  return [...source.matchAll(/^\s*```bash[^\n]*\n([\s\S]*?)^\s*```/gm)]
    .flatMap(([, body]) => body.replace(/\\\n\s*/g, " ").split("\n"))
    .map((line) => line.trim().replace(/^npx @airscale\/cli\b/, "airscale"))
    .filter((line) => /(?:^|\|\s*)airscale\s/.test(line))
    .map((line) => line.slice(line.indexOf("airscale ")));
}

function validateExample(line) {
  const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g).map((token) => token.replace(/^["']|["']$/g, ""));
  const commandTokens = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const global = globals.get(tokens[i]);
    if (global) {
      if (global.flags.includes("<")) i += 1;
    } else commandTokens.push(tokens[i]);
  }
  const command = contract.commands.find(({ command }) => (
    command.split(" ").every((token, i) => commandTokens[i] === token)
  ));
  const isHelp = tokens.includes("--help") || tokens.includes("-h");
  if (!command) {
    assert.ok(
      (commandTokens.length === 1 && (isHelp || tokens.includes("--version")))
      || (commandTokens[1] === "help" && commandTokens.length <= 3),
      `Unsupported example command: ${line}`
    );
    return;
  }
  const allowed = new Map([...globals, ...command.options.flatMap((option) => optionNames(option).map((name) => [name, option]))]);
  for (let i = 1; i < tokens.length; i += 1) {
    if (!/^--?[a-z]/i.test(tokens[i])) continue;
    const option = allowed.get(tokens[i]);
    assert.ok(option, `${command.command} does not support ${tokens[i]}`);
    if (option.flags.includes("<")) {
      const value = tokens[++i];
      assert.ok(value && !value.startsWith("--"), `${option.flags} needs a value`);
      if (option.choices) assert.ok(option.choices.includes(value), `${option.flags}: invalid value ${value}`);
    }
  }
  if (isHelp) return;
  for (const option of command.options.filter(({ required }) => required)) {
    assert.ok(optionNames(option).some((name) => tokens.includes(name)), `${line}: missing ${option.flags}`);
  }
  if (command.command.endsWith(" search") || command.command === "airscale enrich file") {
    assert.ok(tokens.includes("--dry-run") || tokens.includes("--confirm-credit-spend"), `${line}: paid examples must explicitly confirm spend`);
    assert.ok(tokens.includes("--max-credits"), `${line}: paid examples must bound credits`);
  }
}

test("CLI is immediately after MCP and contains exactly the two requested pages", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  const tabs = config.navigation.tabs;
  assert.deepEqual(tabs.map(({ tab }) => tab), ["Documentation", "API Reference", "MCP & Agents", "CLI", "Use cases"]);
  assert.deepEqual(tabs[tabs.findIndex(({ tab }) => tab === "MCP & Agents") + 1], {
    tab: "CLI", groups: [{ group: "Getting started", pages: paths }]
  });
  for (const [path, source] of Object.entries(pages)) {
    const frontmatter = parseDocument(source.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.deepEqual(frontmatter.errors, []);
    assert.equal(frontmatter.toJS().title, path.endsWith("overview") ? "Airscale CLI" : "Command reference");
    assert.equal(frontmatter.toJS().canonical, `https://airscale.mintlify.app/${path}`);
  }
});

test("overview retains the requested sections and native npm install tabs", () => {
  const source = pages["cli/overview"];
  assert.deepEqual([...source.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading), [
    "Install", "Authenticate", "Quick examples", "Output and exit codes", "Configuration"
  ]);
  assert.equal((source.match(/<Tabs>/g) ?? []).length, 1);
  assert.deepEqual([...source.matchAll(/<Tab title="([^"]+)">/g)].map(([, title]) => title), ["npx (no install)", "npm (global)"]);
  assert.ok(source.includes(`npx ${contract.package} --help`));
  assert.ok(source.includes(`npm install --global ${contract.package}`));
  assert.ok(source.includes(contract.node.replace(">=", "" ).replace(/\.0$/, "")));
  assert.doesNotMatch(source, /Homebrew|brew (?:tap|install)|github\.com\/ViceScale\/airscale-code/i);
});

test("command reference covers the source-pinned action commands, arguments, and every flag", () => {
  assert.match(contract.source.revision, /^[a-f0-9]{40}$/);
  assert.match(contract.source.sha256["cli/airscale/src/program.ts"], /^[a-f0-9]{64}$/);
  const source = pages["cli/commands"];
  assert.ok(source.includes(`**${contract.version}**`));
  const headings = [...source.matchAll(/^### `(airscale [^`]+)`$/gm)].map(([, heading]) => heading);
  assert.deepEqual(headings, contract.commands.map(({ command, arguments: args }) => (
    [command, ...args.map(({ name, required }) => required ? `<${name}>` : `[${name}]`)].join(" ")
  )));
  for (const option of [...contract.globalOptions, ...contract.commands.flatMap(({ options }) => options)]) {
    assert.ok(source.includes(`\`${option.flags}\``), `Missing flag table entry: ${option.flags}`);
  }
});

test("all documented shell commands use supported options and bounded paid examples", () => {
  const examples = Object.values(pages).flatMap(bashCommands);
  assert.ok(examples.length >= 20);
  for (const example of examples) validateExample(example);
  assert.throws(() => validateExample("airscale auth status --api-key exposed"), /does not support --api-key/);
  assert.throws(() => validateExample("airscale enrich file contacts.csv --output out.csv --jsonl"), /does not support --jsonl/);
  assert.throws(() => validateExample("airscale companies search --country France --max-credits 2"), /must explicitly confirm/);
});

test("CLI pages preserve links, safe credentials, exit codes, and generated agent discovery", () => {
  for (const [path, source] of Object.entries(pages)) {
    assertBalancedCodeFences(source, path);
    assertLocalDocumentationLinksResolve(source, path);
    assertNoStaticCredentials(source, path);
    assert.doesNotMatch(source, /airscale\s+(?:login|whoami|contacts|accounts|leads|lists|signals|jobs|config|autocomplete)\b/);
  }
  const overview = pages["cli/overview"];
  assert.deepEqual([...overview.matchAll(/^\| `(\d+)` \|/gm)].map(([, code]) => Number(code)), [0, 2, 3, 4, 5, 130]);
  assert.match(overview, /API keys cannot be passed as command-line arguments/);
  assert.match(overview, /without authentication, network requests, or credit spend/);
  for (const file of ["llms.txt", "llms-full.txt"]) {
    const generated = readFileSync(file, "utf8");
    for (const path of paths) assert.ok(generated.includes(`https://airscale.mintlify.app/${path}.md`), `${file} must expose ${path}`);
  }
});
