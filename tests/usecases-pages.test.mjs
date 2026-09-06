import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseDocument } from "yaml";
import { assertBalancedCodeFences, assertNoStaticCredentials } from "./helpers/content-safety.mjs";

const manifest = JSON.parse(readFileSync("inventory/airschool-usecases.json", "utf8"));
const config = JSON.parse(readFileSync("docs.json", "utf8"));
const normalize = (value) => value.replace(/\s+/gu, "");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const plainText = (node) => ["text", "code", "inlineCode"].includes(node.type)
  ? node.value : (node.children ?? []).map(plainText).join("");
function collect(node, type) {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((child) => collect(child, type))];
}

test("Use cases mirrors all eight live sidebar routes in the three source groups", () => {
  assert.deepEqual(manifest.navigation.map(({ group, pages }) => [group, pages.length]), [
    ["Getting started", 1], ["Using AI", 3], ["GTM use cases", 4]
  ]);
  const paths = manifest.navigation.flatMap(({ pages }) => pages);
  assert.equal(paths.length, 8);
  assert.equal(new Set(paths).size, 8);
  assert.deepEqual(config.navigation.tabs.map(({ tab }) => tab), ["Documentation", "API Reference", "MCP & Agents", "Use cases"]);
  assert.deepEqual(config.navigation.tabs[3], { tab: "Use cases", groups: manifest.navigation });
  assert.deepEqual(manifest.pages.map(({ path }) => path), paths);
  assert.deepEqual(readdirSync("usecases").filter((name) => name.endsWith(".mdx")).sort(), paths.map((path) => `${path.slice(9)}.mdx`).sort());
});

for (const page of manifest.pages) {
  test(`${page.path} retains source text, structure, media, links, and preview metadata`, () => {
    const source = readFileSync(`${page.path}.mdx`, "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(match, "frontmatter exists");
    const document = parseDocument(match[1]);
    assert.equal(document.errors.length, 0);
    assert.deepEqual(document.toJS(), {
      title: page.title, description: page.description,
      canonical: `https://airscale.mintlify.app/${page.path}`
    });
    const body = match[2];
    const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    assert.equal(hash(normalize(plainText(tree))), page.textSha256, "all source text must survive in order without duplicated breakpoint variants");
    assert.deepEqual(collect(tree, "heading").map((heading) => ({ level: heading.depth, text: plainText(heading).trim() })), page.headings.map((heading) => ({ ...heading, text: heading.text.trim() })));
    assert.deepEqual(collect(tree, "table").map((table) => table.children.map((row) => row.children.map((cell) => normalize(plainText(cell))))), page.tables.map((table) => table.map((row) => row.map(normalize))));
    assert.deepEqual(collect(tree, "code").map(({ value }) => value), page.codeBlocks.map((value) => value.replace(/^\n+|\n+$/g, "").split("\n").map((line) => line.trimEnd()).join("\n")));
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

test("every migrated image and video matches the downloaded source checksum", () => {
  assert.equal(new Set(manifest.assets.map(({ path }) => path)).size, manifest.assets.length);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(asset.path);
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(hash(bytes), asset.sha256, asset.path);
  }
});

test("all 21 prompt templates retain copy controls, wrapping, and expansion", () => {
  const page = manifest.pages.find(({ path }) => path === "usecases/templates");
  assert.equal(page.codeBlocks.length, 21);
  const source = readFileSync("usecases/templates.mdx", "utf8");
  assert.equal((source.match(/^```text wrap expandable$/gm) ?? []).length, 21);
  assert.doesNotMatch(source, /nocopy/);
  assert.equal(page.headings.length, 22);
});
