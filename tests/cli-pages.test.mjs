import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";
import {
  assertBalancedCodeFences,
  assertLocalDocumentationLinksResolve,
  assertNoStaticCredentials
} from "./helpers/content-safety.mjs";

const contract = JSON.parse(readFileSync("contracts/cli.json", "utf8"));
const paths = ["cli/overview", "cli/commands", "cli/troubleshooting"];
const pages = Object.fromEntries(paths.map((path) => [
  path,
  existsSync(`${path}.mdx`) ? readFileSync(`${path}.mdx`, "utf8") : ""
]));
const optionNames = (option) => option.flags.match(/--[a-z][a-z-]*|-[A-Za-z]\b/g);
const globals = new Map(contract.globalOptions.flatMap((option) => optionNames(option).map((name) => [name, option])));

function bashCommands(source) {
  return [...source.matchAll(/^\s*```bash[^\n]*\n([\s\S]*?)^\s*```/gm)]
    .flatMap(([, body]) => body.replace(/\\\n\s*/g, " ").split("\n"))
    .map((line) => line.trim().replace(/^npx @airscale\/cli\b/, "airscale"))
    .filter((line) => /(?:^|\|\s*)airscale\s/.test(line))
    .map((line) => line.slice(line.indexOf("airscale ")));
}

function commandNames(command) {
  return [command.command, ...(command.aliases ?? [])];
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
  const command = contract.commands.find((candidate) => commandNames(candidate).some((name) => (
    name.split(" ").every((token, i) => commandTokens[i] === token)
  )));
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
  for (const option of command.options.filter(({ requiredUnless }) => requiredUnless)) {
    const exceptionPresent = option.requiredUnless.some((name) => tokens.includes(name));
    assert.ok(exceptionPresent || optionNames(option).some((name) => tokens.includes(name)), `${line}: missing ${option.flags}`);
  }
  if (command.command.endsWith(" search") || command.command === "airscale enrich file") {
    const dryRun = tokens.includes("--dry-run");
    assert.ok(dryRun || tokens.includes("--confirm-credit-spend"), `${line}: paid examples must explicitly confirm spend`);
    if (!dryRun) assert.ok(tokens.includes("--max-credits"), `${line}: paid examples must bound credits`);
  }
}

test("CLI follows MCP and exposes onboarding, reference, and troubleshooting pages", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  const tabs = config.navigation.tabs;
  assert.deepEqual(tabs.map(({ tab }) => tab), ["Documentation", "API Reference", "MCP & Agents", "CLI", "Use cases"]);
  assert.deepEqual(tabs[tabs.findIndex(({ tab }) => tab === "MCP & Agents") + 1], {
    tab: "CLI", groups: [{ group: "Getting started", pages: paths }]
  });
  const expectedTitles = {
    "cli/overview": "Airscale CLI",
    "cli/commands": "Command reference",
    "cli/troubleshooting": "Troubleshooting"
  };
  for (const [path, source] of Object.entries(pages)) {
    const match = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(match, `${path} must exist with frontmatter`);
    const frontmatter = parseDocument(match[1]);
    assert.deepEqual(frontmatter.errors, []);
    assert.equal(frontmatter.toJS().title, expectedTitles[path]);
    assert.equal(frontmatter.toJS().canonical, `https://airscale.mintlify.app/${path}`);
  }
});

test("overview leads to a free outputless dry run before authentication", () => {
  const source = pages["cli/overview"];
  assert.equal((source.match(/<Tabs>/g) ?? []).length, 1);
  assert.deepEqual([...source.matchAll(/<Tab title="([^"]+)">/g)].map(([, title]) => title), ["npx (no install)", "npm (global)"]);
  assert.ok(source.includes(`npx ${contract.package} --help`));
  assert.ok(source.includes(`npm install --global ${contract.package}`));
  assert.ok(source.includes(contract.node.replace(">=", "").replace(/\.0$/, "")));
  assert.match(source, /first_name,last_name,domain\n[^\n]+\.example\n[^\n]+\.example/);
  const dryRun = bashCommands(source).find((line) => line.includes("enrich file contacts.csv") && line.includes("--dry-run"));
  assert.equal(dryRun?.replace(/\s+/g, " "), "airscale enrich file contacts.csv --dry-run --json --quiet");
  assert.match(source, /"rows": 2,[\s\S]*"valid_rows": 2,[\s\S]*"estimated_max_credits": 4,[\s\S]*"field": "work_email",[\s\S]*"format": "csv",[\s\S]*"output": null,[\s\S]*"dry_run": true/);
  assert.match(source, /airscale auth login[\s\S]*airscale auth status --json/);
  assert.match(source, /airscale setup/);
  const authorizedContacts = source.indexOf("Replace the fictional rows with contacts you are authorized to enrich");
  const paidEnrichment = source.indexOf("airscale enrich file contacts.csv", authorizedContacts);
  assert.ok(authorizedContacts > 0, "the fictional preview must not lead directly into paid work");
  assert.ok(paidEnrichment > authorizedContacts, "authorization guidance must precede the paid command");
  assert.match(source.slice(authorizedContacts, paidEnrichment), /run the free preview again/i);
  assert.doesNotMatch(source, /Homebrew|brew (?:tap|install)|github\.com\/ViceScale\/airscale-code/i);
});

test("command reference covers 0.2.0 commands, aliases, arguments, and every flag", () => {
  assert.match(contract.source.revision, /^[a-f0-9]{40}$/);
  assert.match(contract.source.sha256["cli/airscale/src/program.ts"], /^[a-f0-9]{64}$/);
  assert.equal(contract.version, "0.2.0");
  const source = pages["cli/commands"];
  assert.ok(source.includes(`**${contract.version}**`));
  const headings = [...source.matchAll(/^### `(airscale [^`]+)`$/gm)].map(([, heading]) => heading);
  assert.deepEqual(headings, contract.commands.map(({ command, arguments: args }) => (
    [command, ...args.map(({ name, required }) => required ? `<${name}>` : `[${name}]`)].join(" ")
  )));
  for (const option of [...contract.globalOptions, ...contract.commands.flatMap(({ options }) => options)]) {
    assert.ok(source.includes(`\`${option.flags}\``), `Missing flag table entry: ${option.flags}`);
  }
  const login = contract.commands.find(({ command }) => command === "airscale auth login");
  assert.deepEqual(login?.aliases, ["airscale auth set-key"]);
  assert.match(source, /`airscale auth set-key`[^\n]+alias/i);
  assert.ok(contract.commands.some(({ command }) => command === "airscale setup"));
  assert.deepEqual(contract.commands.find(({ command }) => command === "airscale completion")?.arguments, [
    { name: "shell", required: true, choices: ["bash", "zsh"] }
  ]);
  const enrichOutput = contract.commands.find(({ command }) => command === "airscale enrich file")
    ?.options.find(({ flags }) => flags === "--output <path>");
  assert.deepEqual(enrichOutput?.requiredUnless, ["--dry-run"]);
});

test("examples use supported options, safe budgets, and conditional enrichment output", () => {
  const examples = Object.values(pages).flatMap(bashCommands);
  assert.ok(examples.length >= 24);
  for (const example of examples) validateExample(example);
  assert.ok(examples.some((line) => /--max-credits 0\.5(?:\s|$)/.test(line)), "show a fractional credit ceiling");
  for (const line of examples) {
    for (const match of line.matchAll(/--(?:size|limit)\s+(\S+)/g)) {
      assert.match(match[1], /^\d+$/, `count flags stay integral: ${line}`);
    }
  }
  assert.doesNotThrow(() => validateExample("airscale enrich file contacts.csv --dry-run --json --quiet"));
  assert.throws(() => validateExample("airscale enrich file contacts.csv --max-credits 4 --confirm-credit-spend"), /missing --output/);
  assert.throws(() => validateExample("airscale auth status --api-key exposed"), /does not support --api-key/);
  assert.throws(() => validateExample("airscale enrich file contacts.csv --output out.csv --jsonl"), /does not support --jsonl/);
  assert.throws(() => validateExample("airscale companies search --country France --max-credits 2"), /must explicitly confirm/);
});

test("reference documents stdout, decimal budgets, setup safety, and 0.1 compatibility", () => {
  const source = pages["cli/commands"];
  assert.match(source, /all result formats[^.]*stdout/i);
  assert.match(source, /progress and errors[^.]*stderr/i);
  assert.match(source, /`--output -`[^.]*stdout/i);
  assert.match(source, /plain positive decimal/i);
  assert.match(source, /`0\.5`/);
  assert.match(source, /9,007,199,254,740,991/);
  assert.match(source, /scientific notation[^.]*rejected/i);
  assert.match(source, /`Infinity`[^.]*rejected/i);
  assert.doesNotMatch(source, /any positive finite decimal/i);
  assert.match(source, /non-interactive[\s\S]{0,180}before[\s\S]{0,120}(?:credential|HTTP)/i);
  assert.match(source, /shell script[^.]*stdout/i);
  assert.match(source, /does not (?:edit|change|modify)[^.]*profile/i);
  assert.match(source, /0\.1\.0 to 0\.2\.0 compatibility/i);
});

test("troubleshooting covers install, auth, input, spending, resume, setup, and completion", () => {
  const source = pages["cli/troubleshooting"];
  for (const pattern of [
    /Node\.js 20\.3/i,
    /npm/i,
    /PATH/,
    /No Airscale API key configured/i,
    /invalid API key/i,
    /invalid CSV/i,
    /confirm-credit-spend/,
    /--resume/,
    /airscale setup/,
    /airscale completion (?:bash|zsh)/
  ]) assert.match(source, pattern);
  assert.match(source, /setup[^.]*interactive terminal/i);
  assert.match(source, /completion[^.]*opt in/i);
  const zsh = source.match(/```zsh\n([\s\S]*?)\n```/)?.[1] ?? "";
  assert.match(zsh, /autoload -Uz compinit/);
  assert.ok(zsh.indexOf("compinit") < zsh.indexOf("source <(airscale completion zsh)"));
  assert.match(source, /current (?:zsh|bash|shell) session/i);
  assert.match(source, /source <\(airscale completion bash\)/);
  const invalidKey = source.match(/## Invalid API key\n([\s\S]*?)(?=\n## )/)?.[1] ?? "";
  assert.match(invalidKey, /`AIRSCALE_API_KEY`[^.]*takes precedence[^.]*saved credential/i);
  assert.match(invalidKey, /prints only whether[^.]*set or unset/i);
  assert.match(invalidKey, /When `auth status` succeeds[^.]*source[^.]*fingerprint/i);
  assert.doesNotMatch(invalidKey, /status output reports `source:[^`]+` or `source:[^`]+`/i);
});

test("CLI pages preserve links, safe credentials, exit codes, and generated discovery", () => {
  for (const [path, source] of Object.entries(pages)) {
    assertBalancedCodeFences(source, path);
    assertLocalDocumentationLinksResolve(source, path);
    assertNoStaticCredentials(source, path);
    assert.doesNotMatch(source, /airscale\s+(?:whoami|contacts|accounts|leads|lists|signals|jobs|config|autocomplete)\b/);
  }
  const overview = pages["cli/overview"];
  assert.deepEqual([...overview.matchAll(/^\| `(\d+)` \|/gm)].map(([, code]) => Number(code)), [0, 2, 3, 4, 5, 130]);
  assert.match(overview, /API keys cannot be passed as command-line arguments/);
  assert.match(overview, /without (?:authentication|credentials), (?:network|HTTP) requests, or credit spend/);
  for (const file of ["llms.txt", "llms-full.txt"]) {
    const generated = readFileSync(file, "utf8");
    for (const path of paths) assert.ok(generated.includes(`https://airscale.mintlify.app/${path}.md`), `${file} must expose ${path}`);
  }
});
