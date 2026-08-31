import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";
import * as updater from "../scripts/set-preview-canonicals.mjs";

const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const policy = JSON.parse(readFileSync("contracts/publication-policy.json", "utf8"));
const config = JSON.parse(readFileSync("docs.json", "utf8"));

function mdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxFiles(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

function frontmatterValue(source, key, path) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must start with YAML frontmatter`);
  const lines = match[1].split("\n");
  const matches = lines.filter((candidate) => candidate.startsWith(`${key}:`));
  assert.equal(matches.length, 1, `${path} must define exactly one ${key}`);
  return JSON.parse(matches[0].slice(key.length + 1).trim());
}

function expectedCanonical(path) {
  return `${policy.previewOrigin}/${path.replace(/\.mdx$/, "")}`;
}

function frontmatterDocument(source, path) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must start with YAML frontmatter`);
  const document = parseDocument(match[1]);
  assert.equal(document.errors.length, 0, `${path} frontmatter must parse as YAML`);
  return document;
}

function topLevelCanonicalPairs(document) {
  return document.contents?.items?.filter((pair) => pair.key?.value === "canonical") ?? [];
}

test("publication policy is preview-only and forbids live-domain mutations", () => {
  assert.deepEqual(policy, {
    previewOrigin: "https://airscale.mintlify.app",
    liveDocumentationOrigin: "https://docs.airscale.io",
    previewRobots: "noindex, follow",
    dnsChangesAllowed: false,
    liveRedirectsAllowed: false,
    liveSiteWritesAllowed: false
  });
});

test("docs configuration identifies the complete knowledge base and keeps the preview noindex", () => {
  assert.equal(
    config.description,
    "Airscale product guides, integration workflows, MCP documentation, and public API reference."
  );
  assert.equal(config.seo.indexing, "navigable");
  assert.equal(config.seo.metatags.robots, policy.previewRobots);
  assert.equal(config.search.prompt, "Search Airscale documentation...");
});

test("foundation config does not declare live-domain redirects", () => {
  assert.equal(Object.hasOwn(config, "redirects"), false);
  assert.equal(policy.dnsChangesAllowed, false);
  assert.equal(policy.liveRedirectsAllowed, false);
  assert.equal(policy.liveSiteWritesAllowed, false);
});

test("package toolchain pins local Mint and YAML validation dependencies", () => {
  assert.equal(packageManifest.devDependencies?.mint, "4.2.850");
  assert.equal(packageManifest.devDependencies?.yaml, "2.9.0");
  assert.equal(packageManifest.scripts?.["mint:validate"], "mint validate");
  assert.equal(packageManifest.scripts?.validate.includes("npx"), false);
});

test("every current content page declares its preview-host canonical", () => {
  const files = mdxFiles("api-reference");
  assert.equal(files.length, 18);

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    assert.equal(frontmatterValue(source, "canonical", path), expectedCanonical(path));
  }
});

test("every current content page is byte-idempotent under canonical synchronization", () => {
  for (const path of mdxFiles("api-reference")) {
    const source = readFileSync(path, "utf8");
    const result = updater.updateFrontmatterSource(path, source);

    assert.equal(result.changed, false, `${path} must not require metadata changes`);
    assert.equal(result.nextSource, source, `${path} must remain byte-identical`);
  }
});

test("canonical generation cannot target the live documentation origin", () => {
  const canonical = expectedCanonical("api-reference/find-people.mdx");
  assert.equal(canonical, "https://airscale.mintlify.app/api-reference/find-people");
  assert.equal(canonical.startsWith(policy.liveDocumentationOrigin), false);
});

test("updater canonical generation uses the publication policy preview origin", () => {
  assert.equal(
    updater.canonicalFor("api-reference/find-people.mdx"),
    expectedCanonical("api-reference/find-people.mdx")
  );
});

test("updater inserts canonical after a single-line description", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.equal(result.changed, true);
  assert.match(
    result.nextSource,
    /description: "A fixture page\."\ncanonical: "https:\/\/airscale\.mintlify\.app\/api-reference\/fixture"\n---/
  );
});

test("updater replaces duplicate stale canonicals with exactly one current value", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: "https://old.example/fixture"\ncanonical: "https://older.example/fixture"\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);
  const frontmatter = result.nextSource.match(/^---\n([\s\S]*?)\n---/)[1];

  assert.equal((frontmatter.match(/^canonical:/gm) ?? []).length, 1);
  assert.equal(
    frontmatterValue(result.nextSource, "canonical", "fixture"),
    `${updater.PREVIEW_ORIGIN}/api-reference/fixture`
  );
});

test("updater fails closed on a folded canonical without corrupting source", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: >-\n  https://old.example/fixture\nother: true\n---\n`;

  assert.throws(
    () => updater.updateFrontmatterSource("api-reference/fixture.mdx", source),
    /api-reference\/fixture\.mdx canonical must be a single-line scalar/
  );
  assert.equal(source, `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: >-\n  https://old.example/fixture\nother: true\n---\n`);
});

test("updater fails closed when duplicate canonicals include a block scalar", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: "https://old.example/fixture"\ncanonical: |\n  https://older.example/fixture\n---\n`;

  assert.throws(
    () => updater.updateFrontmatterSource("api-reference/fixture.mdx", source),
    /api-reference\/fixture\.mdx canonical must be a single-line scalar/
  );
  assert.equal(source, `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: "https://old.example/fixture"\ncanonical: |\n  https://older.example/fixture\n---\n`);
});

test("updater fails closed on an anchored canonical scalar", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: &fixture "https://old.example/fixture"\n---\n`;

  assert.throws(
    () => updater.updateFrontmatterSource("api-reference/fixture.mdx", source),
    /api-reference\/fixture\.mdx canonical must be a single-line scalar/
  );
  assert.equal(source, `---\ntitle: "Fixture"\ndescription: "A fixture page."\ncanonical: &fixture "https://old.example/fixture"\n---\n`);
});

const complexCanonicalFixtures = [
  ["tagged", `canonical: !!str "https://old.example/fixture"`],
  ["aliased", `anchor: &fixture "https://old.example/fixture"\ncanonical: *fixture`],
  ["multiline quoted", `canonical: "First line\n  second line"`],
  ["multiline plain", `canonical: First line\n  second line`]
];

for (const [name, canonicalField] of complexCanonicalFixtures) {
  test(`updater fails closed on a ${name} canonical`, () => {
    const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\n${canonicalField}\n---\n`;

    assert.throws(
      () => updater.updateFrontmatterSource("api-reference/fixture.mdx", source),
      /api-reference\/fixture\.mdx canonical must be a single-line scalar/
    );
    assert.equal(source, `---\ntitle: "Fixture"\ndescription: "A fixture page."\n${canonicalField}\n---\n`);
  });
}

test("updater rejects duplicate canonical keys in a nested mapping", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\nmetadata:\n  canonical: "https://old.example/fixture"\n  canonical: "https://older.example/fixture"\n---\n`;

  assert.throws(
    () => updater.updateFrontmatterSource("api-reference/fixture.mdx", source),
    /api-reference\/fixture\.mdx input frontmatter must not duplicate key "canonical"/
  );
  assert.equal(source, `---\ntitle: "Fixture"\ndescription: "A fixture page."\nmetadata:\n  canonical: "https://old.example/fixture"\n  canonical: "https://older.example/fixture"\n---\n`);
});

test("updater parses generated frontmatter with exactly one exact canonical", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "A fixture page."\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);
  const document = frontmatterDocument(result.nextSource, "api-reference/fixture.mdx");
  const canonicals = topLevelCanonicalPairs(document);

  assert.equal(canonicals.length, 1);
  assert.equal(canonicals[0].value.value, expectedCanonical("api-reference/fixture.mdx"));
});

test("updater preserves a complete multiline description before canonical", () => {
  const source = `---\ntitle: "Fixture"\ndescription: |-\n  First line.\n  Second line.\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.match(
    result.nextSource,
    /description: \|-\n  First line\.\n  Second line\.\nother: true\ncanonical: "https:\/\/airscale\.mintlify\.app\/api-reference\/fixture"\n---/
  );
});

test("updater recognizes YAML block-scalar indentation and chomping indicators", () => {
  const source = `---\ntitle: "Fixture"\ndescription: >2-\n    First line.\n    Second line.\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.match(
    result.nextSource,
    /description: >2-\n    First line\.\n    Second line\.\nother: true\ncanonical: "https:\/\/airscale\.mintlify\.app\/api-reference\/fixture"\n---/
  );
});

test("updater preserves multiline quoted descriptions and appends canonical last", () => {
  const source = `---\ntitle: "Fixture"\ndescription: "First line\n  second line"\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.equal(
    result.nextSource,
    `---\ntitle: "Fixture"\ndescription: "First line\n  second line"\nother: true\ncanonical: "https://airscale.mintlify.app/api-reference/fixture"\n---\n`
  );
});

test("updater preserves multiline plain descriptions and appends canonical last", () => {
  const source = `---\ntitle: "Fixture"\ndescription: First line\n  second line\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.equal(
    result.nextSource,
    `---\ntitle: "Fixture"\ndescription: First line\n  second line\nother: true\ncanonical: "https://airscale.mintlify.app/api-reference/fixture"\n---\n`
  );
});

test("updater updates one canonical in place without moving it", () => {
  const source = `---\ntitle: "Fixture"\ncanonical: "https://old.example/fixture"\ndescription: "A fixture page."\nother: true\n---\n`;
  const result = updater.updateFrontmatterSource("api-reference/fixture.mdx", source);

  assert.equal(result.changed, true);
  assert.equal(
    result.nextSource,
    `---\ntitle: "Fixture"\ncanonical: "https://airscale.mintlify.app/api-reference/fixture"\ndescription: "A fixture page."\nother: true\n---\n`
  );
});

test("updater is idempotent and skips unchanged writes", () => {
  const files = new Map([
    [
      "api-reference/fixture.mdx",
      `---\ntitle: "Fixture"\ndescription: "A fixture page."\n---\n`
    ]
  ]);
  const writes = [];
  const io = {
    read: (path) => files.get(path),
    write: (path, source) => {
      writes.push(path);
      files.set(path, source);
    }
  };

  assert.deepEqual(updater.synchronizeFiles([...files.keys()], io), { scanned: 1, changed: 1 });
  assert.deepEqual(updater.synchronizeFiles([...files.keys()], io), { scanned: 1, changed: 0 });
  assert.deepEqual(writes, ["api-reference/fixture.mdx"]);
});

test("updater validates every page before writing any page", () => {
  const files = new Map([
    [
      "api-reference/01-valid.mdx",
      `---\ntitle: "Valid"\ndescription: "A valid fixture."\n---\n`
    ],
    ["api-reference/02-invalid.mdx", `---\ntitle: "Invalid"\n---\n`]
  ]);
  const before = new Map(files);
  const writes = [];

  assert.throws(
    () =>
      updater.synchronizeFiles([...files.keys()].sort(), {
        read: (path) => files.get(path),
        write: (path, source) => {
          writes.push(path);
          files.set(path, source);
        }
      }),
    /02-invalid\.mdx must define description before canonical/
  );
  assert.deepEqual(files, before);
  assert.deepEqual(writes, []);
});

test("updater prevalidates a complex canonical before writing any earlier valid page", () => {
  const files = new Map([
    [
      "api-reference/01-valid.mdx",
      `---\ntitle: "Valid"\ndescription: "A valid fixture."\n---\n`
    ],
    [
      "api-reference/02-complex.mdx",
      `---\ntitle: "Complex"\ndescription: "A complex fixture."\ncanonical: >-\n  https://old.example/complex\n---\n`
    ]
  ]);
  const before = new Map(files);
  const writes = [];

  assert.throws(
    () =>
      updater.synchronizeFiles([...files.keys()].sort(), {
        read: (path) => files.get(path),
        write: (path, source) => {
          writes.push(path);
          files.set(path, source);
        }
      }),
    /02-complex\.mdx canonical must be a single-line scalar/
  );
  assert.deepEqual(files, before);
  assert.deepEqual(writes, []);
});

for (const duplicateKey of ["title", "description"]) {
  test(`updater prevalidates duplicate ${duplicateKey} before writing any earlier valid page`, () => {
    const files = new Map([
      [
        "api-reference/01-valid.mdx",
        `---\ntitle: "Valid"\ndescription: "A valid fixture."\n---\n`
      ],
      [
        "api-reference/02-duplicate.mdx",
        `---\ntitle: "Duplicate"\ndescription: "A duplicate fixture."\n${duplicateKey}: "again"\n---\n`
      ]
    ]);
    const before = new Map(files);
    const writes = [];

    assert.throws(
      () =>
        updater.synchronizeFiles([...files.keys()].sort(), {
          read: (path) => files.get(path),
          write: (path, source) => {
            writes.push(path);
            files.set(path, source);
          }
        }),
      new RegExp(`02-duplicate\\.mdx input frontmatter must not duplicate key "${duplicateKey}"`)
    );
    assert.deepEqual(files, before);
    assert.deepEqual(writes, []);
  });
}
