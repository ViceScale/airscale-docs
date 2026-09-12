import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseDocument } from "yaml";
import { assertBalancedCodeFences, assertNoStaticCredentials } from "./helpers/content-safety.mjs";

const manifest = JSON.parse(readFileSync("inventory/airschool-documentation.json", "utf8"));
const config = JSON.parse(readFileSync("docs.json", "utf8"));
const normalize = (value) => value.replace(/\s+/gu, "");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const recoveryAddition = /### Recovery and partial results\n\n[\s\S]*?(?=!\[Extract post likers\/commenters — 3\.)/;
const plainText = (node) => ["text", "code", "inlineCode"].includes(node.type)
  ? node.value : (node.children ?? []).map(plainText).join("");
function collect(node, type) {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((child) => collect(child, type))];
}

test("Documentation mirrors all 48 live sidebar routes in the five source groups", () => {
  assert.deepEqual(manifest.navigation.map(({ group, pages }) => [group, pages.length]), [
    ["Build lists", 10], ["Enrichments", 26], ["Export", 6], ["CRM integrations", 2], ["Utilities", 4]
  ]);
  const paths = manifest.navigation.flatMap(({ pages }) => pages);
  assert.equal(paths.length, 48);
  assert.equal(new Set(paths).size, 48);
  assert.deepEqual(config.navigation.tabs.map(({ tab }) => tab), ["Documentation", "API Reference", "MCP & Agents", "CLI", "Use cases"]);
  assert.deepEqual(config.navigation.tabs[0], { tab: "Documentation", groups: manifest.navigation });
  assert.deepEqual(manifest.pages.map(({ path }) => path), paths);
  assert.deepEqual(readdirSync("docs").filter((name) => name.endsWith(".mdx")).sort(), paths.map((path) => `${path.slice(5)}.mdx`).sort());
  assert.ok(paths.includes("docs/filer-tables"), "preserve the source URL even though its slug has a typo");
});

for (const page of manifest.pages) {
  test(`${page.path} retains source text, structure, media, links, and preview metadata`, () => {
    const source = readFileSync(`${page.path}.mdx`, "utf8");
    assert.doesNotMatch(source, /Airscale/, "published copy uses Airschool");
    // Keep the captured source checksums unchanged; only the approved display name differs.
    const match = source.replaceAll("Airschool", "Airscale").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(match, "frontmatter exists");
    const document = parseDocument(match[1]);
    assert.equal(document.errors.length, 0);
    assert.deepEqual(document.toJS(), {
      title: page.title, description: page.description,
      canonical: `https://airscale.mintlify.app/${page.path}`
    });
    const body = match[2];
    // The deployed recovery update extends this guide; preserve every captured source element.
    const capturedBody = page.path === "docs/likers-commenters" ? body.replace(recoveryAddition, "") : body;
    const tree = fromMarkdown(capturedBody, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    assert.equal(hash(normalize(plainText(tree))), page.textSha256, "all source text must survive in order without duplicated breakpoint variants");
    assert.deepEqual(collect(tree, "heading").map((heading) => ({ level: heading.depth, text: plainText(heading).trim() })), page.headings.map((heading) => ({ ...heading, text: heading.text.trim() })));
    assert.deepEqual(collect(tree, "table").map((table) => table.children.map((row) => row.children.map((cell) => normalize(plainText(cell))))), page.tables.map((table) => table.map((row) => row.map(normalize))));
    assert.deepEqual(collect(tree, "code").map(({ value }) => value), page.codeBlocks.map((value) => value.replace(/^\n|\n$/g, "")));
    assert.deepEqual(collect(tree, "image").map(({ url, alt }) => ({ path: url.slice(1), alt })), page.images);
    for (const image of page.images) assert.ok(existsSync(image.path), `${image.path} is stored locally`);
    assert.equal((body.match(/<iframe\b/g) ?? []).length, page.videos.length);
    for (const video of page.videos) assert.ok(body.includes(video.replaceAll("&", "&amp;")), "original video survives with autoplay disabled");
    assert.equal((body.match(/<video\b/g) ?? []).length, page.nativeVideos.length);
    for (const video of page.nativeVideos) {
      assert.ok(body.includes(`src="/${video}"`));
      assert.ok(existsSync(video));
    }
    const actualLinks = collect(tree, "link").map(({ url }) => url);
    assert.deepEqual(actualLinks, page.links);
    for (const link of actualLinks.filter((url) => url.startsWith("/"))) {
      assert.ok(existsSync(`${link.split(/[?#]/)[0].slice(1)}.mdx`), `${link} resolves locally`);
    }
    assertBalancedCodeFences(source, page.path);
    assertNoStaticCredentials(source, page.path);
    assert.doesNotMatch(body, /<script\b|javascript:|data:text\/html|framer-text-module|ssr-variant/i);
  });
}

test("post engagement guide adds bounded recovery guidance and resolving API links", () => {
  const source = readFileSync("docs/likers-commenters.mdx", "utf8");
  const additions = source.match(new RegExp(recoveryAddition.source, "g"));
  assert.equal(additions?.length, 1);
  const addition = additions[0];
  for (const text of ["saves fetched pages and import progress", "another eligible account", "deduplicate saved results", "avoid repeating settled charges", "persistent failures beyond the retry budget require support", "Recovery does not remove upstream access or pagination limits", "per-page retry keys and cursor rules differ"]) {
    assert.ok(addition.includes(text), text);
  }
  const tree = fromMarkdown(addition);
  const links = collect(tree, "link").map(({ url }) => url);
  assert.deepEqual(links, ["/api-reference/post-likers", "/api-reference/post-commenters"]);
  for (const link of links) assert.ok(existsSync(`${link.slice(1)}.mdx`));
});

test("every migrated image and video matches the downloaded source checksum", () => {
  assert.equal(new Set(manifest.assets.map(({ path }) => path)).size, manifest.assets.length);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(asset.path);
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(hash(bytes), asset.sha256, asset.path);
  }
});
