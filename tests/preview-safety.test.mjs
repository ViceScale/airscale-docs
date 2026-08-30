import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

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
  const line = match[1].split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  assert.ok(line, `${path} must define ${key}`);
  return JSON.parse(line.slice(key.length + 1).trim());
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

test("every current content page declares its preview-host canonical", () => {
  const files = mdxFiles("api-reference");
  assert.equal(files.length, 16);

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const route = path.replace(/\.mdx$/, "");
    assert.equal(frontmatterValue(source, "canonical", path), `${policy.previewOrigin}/${route}`);
  }
});
