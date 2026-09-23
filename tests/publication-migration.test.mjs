import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { apiRouteCoverage, publicationConfig, renderPublication, preparePublication } from "../scripts/prepare-publication.mjs";

test("all 21 legacy API documentation URLs resolve to pages or exact redirects", () => {
  const config = publicationConfig();
  const coverage = apiRouteCoverage(undefined, config);
  assert.equal(coverage.length, 21);
  assert.equal(coverage.filter(({ behavior }) => behavior === "redirect").length, 3);
  for (const source of ["/api-reference/dnc-checker", "/api-reference/leads-finder"]) {
    assert.deepEqual(coverage.find((row) => row.source === source), { source, destination: source, behavior: "page" });
  }
  assert.throws(() => apiRouteCoverage(undefined, { ...config, redirects: [] }), /Missing redirect/);
});

test("production candidate is deterministic, indexable, and leaves the source preview unchanged", () => {
  const before = readFileSync("docs.json", "utf8");
  const files = renderPublication();
  assert.deepEqual(files, renderPublication());
  const config = JSON.parse(files.get("docs.json"));
  assert.equal(config.seo.metatags.robots, "index, follow");
  assert.equal(config.navigation.tabs[1].groups[0].pages.includes("api-reference/documentation-corrections"), true);
  for (const [path, bytes] of files) {
    if (!/\.(mdx|md|txt|json)$/.test(path)) continue;
    const text = bytes.toString();
    assert.doesNotMatch(text, /airscale\.mintlify\.app/, path);
    assert.doesNotMatch(text, /intentionally noindex|navigable preview corpus/, path);
    if (path.endsWith(".mdx")) assert.match(text, /^canonical: "https:\/\/docs\.airscale\.io\//m, path);
  }
  assert.equal(JSON.parse(files.get("openapi.json")).servers[0].url, "https://api.airscale.io");
  assert.match(files.get("skill.md").toString(), /https:\/\/mcp\.airscale\.io\/mcp/);
  assert.match(files.get("llms.txt").toString(), /https:\/\/docs\.airscale\.io\/api-reference\/dnc-checker.md/);
  assert.equal(readFileSync("docs.json", "utf8"), before);
  assert.equal(JSON.parse(before).seo.metatags.robots, "noindex, follow");
});

test("publication refuses to overwrite any existing directory or the source repository", () => {
  const temporary = mkdtempSync(join(tmpdir(), "airscale-publication-test-"));
  try {
    assert.throws(() => preparePublication(process.cwd()), /source repository/);
    assert.throws(() => preparePublication(temporary), /already exists/);
    assert.throws(() => preparePublication("relative"), /absolute/);
    const output = join(temporary, "site");
    const result = preparePublication(output);
    assert.equal(result.apiRoutes, 21);
    assert.equal(existsSync(join(output, "api-reference/dnc-checker.mdx")), true);
    assert.equal(existsSync(join(output, "docs/superpowers/plans")), false);
    assert.equal(existsSync(join(output, "scripts")), false);
    assert.equal(existsSync(join(output, ".git")), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("SEO publication preserves the root and uses only permanent moved-page redirects", () => {
  const files = renderPublication();
  const config = JSON.parse(files.get("docs.json"));
  assert.equal(config.seo.metatags.canonical, "https://docs.airscale.io");
  assert.ok(files.has("index.mdx"), "the homepage must be published");
  assert.match(files.get("index.mdx").toString(), /^canonical: "https:\/\/docs\.airscale\.io\/"$/m);
  for (const redirect of config.redirects) assert.equal(redirect.permanent, true);
  const manifest = JSON.parse(files.get("publication-manifest.json"));
  assert.equal(manifest.routes.length, 82);
  assert.deepEqual(manifest.routes.find(row => row.source === "/"), {source:"/", destination:"/", behavior:"page"});
  const sitemap = files.get("sitemap.xml").toString();
  assert.match(sitemap, /<loc>https:\/\/docs\.airscale\.io\/<\/loc>/);
  assert.doesNotMatch(sitemap, /mintlify\.app|\/index<|\/api-reference\/airscale-mcp-server</);
  assert.match(files.get("robots.txt").toString(), /Sitemap: https:\/\/docs\.airscale\.io\/sitemap.xml/);
});

test("staging candidate preserves permanent redirects while remaining noindex on the Mintlify host", () => {
  const before = readFileSync("docs.json", "utf8");
  const files = renderPublication(undefined, { staging: true });
  const config = JSON.parse(files.get("docs.json"));
  const manifest = JSON.parse(files.get("publication-manifest.json"));
  assert.equal(config.seo.metatags.robots, "noindex, follow");
  assert.equal(config.seo.metatags.canonical, "https://airscale.mintlify.app");
  assert.equal(manifest.documentationOrigin, "https://airscale.mintlify.app");
  assert.equal(manifest.indexing, "noindex");
  assert.equal(config.redirects.length, 3);
  for (const redirect of config.redirects) assert.equal(redirect.permanent, true);
  assert.match(files.get("index.mdx").toString(), /^canonical: "https:\/\/airscale\.mintlify\.app\/"$/m);
  assert.match(files.get("robots.txt").toString(), /Sitemap: https:\/\/airscale\.mintlify\.app\/sitemap.xml/);
  assert.match(files.get("llms-full.txt").toString(), /intentionally noindex/);
  assert.equal(JSON.parse(files.get("openapi.json")).servers[0].url, "https://api.airscale.io");
  assert.equal(readFileSync("docs.json", "utf8"), before);
  assert.deepEqual(files, renderPublication(undefined, { staging: true }));
});

test("homepage stylesheet and artwork survive both publication modes", () => {
  for (const staging of [true, false]) {
    const files = renderPublication(undefined, { staging });
    for (const path of ["airschool.css", "images/airschool/grid.svg", "images/airschool/documentation.png", "images/airschool/api-reference.png", "images/airschool/use-cases.png"]) {
      assert.ok(files.has(path), `${path} must be included in the ${staging ? 'staging' : 'production'} artifact`);
      assert.deepEqual(files.get(path), readFileSync(path));
    }
  }
});
