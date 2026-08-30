import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const GROUPS = [
  ["Start here", ["api-reference/api-overview", "api-reference/authentication", "api-reference/rate-limits"]],
  ["Search and discovery", ["api-reference/find-people", "api-reference/find-companies", "api-reference/airsearch"]],
  ["Contact data", ["api-reference/email-finder", "api-reference/email-finder-(bulk)", "api-reference/mobile-finder", "api-reference/personal-email", "api-reference/people-url-finder"]],
  ["Profiles and reverse lookup", ["api-reference/extract-people-profile", "api-reference/extract-company-profile", "api-reference/reverse-email", "api-reference/reverse-phone"]],
  ["Account", ["api-reference/credit-count"]]
];

const PAGE_PATHS = GROUPS.flatMap(([, pages]) => pages);

function readPage(path) {
  const source = readFileSync(`${path}.mdx`, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${path} must have frontmatter`);
  const frontmatter = Object.fromEntries(
    match[1].split("\n").filter(Boolean).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^"|"$/g, "")];
    })
  );
  return { source, body: match[2], frontmatter };
}

test("brand configuration and assets match Airscale", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));

  assert.equal(config.name, "Airscale API");
  assert.equal(config.colors.primary, "#4079FF");
  assert.equal(config.logo.light, "/logo/light.svg");
  assert.equal(config.logo.dark, "/logo/dark.svg");
  assert.equal(config.logo.href, "https://airscale.io/");
  assert.equal(config.favicon, "/favicon.svg");
  assert.equal(config.appearance.default, "light");
  assert.equal(config.fonts.family, "Poppins");
  assert.equal(config.navbar.primary.label, "Open dashboard");

  for (const asset of [config.logo.light, config.logo.dark, config.favicon]) {
    assert.ok(existsSync(`.${asset}`), `${asset} must exist`);
  }
  assert.doesNotMatch(JSON.stringify(config.logo), /mintlify\.s3|bubble\.io/);
});

test("navigation contains the five approved groups in order", () => {
  const config = JSON.parse(readFileSync("docs.json", "utf8"));
  const groups = config.navigation.tabs[0].groups.map(({ group, pages }) => [group, pages]);

  assert.deepEqual(groups, GROUPS);
});

test("exactly the approved 16 pages exist", () => {
  const actualPages = readdirSync("api-reference")
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => `api-reference/${file.slice(0, -4)}`)
    .sort();

  assert.deepEqual(actualPages, [...PAGE_PATHS].sort());
  assert.ok(!actualPages.includes("api-reference/leads-finder"));
});

test("every page has baseline-safe MDX", () => {
  for (const path of PAGE_PATHS) {
    const { source, frontmatter } = readPage(path);

    assert.ok(frontmatter.title, `${path} must have a title`);
    assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `${path} must have balanced code fences`);
    assert.doesNotMatch(
      source,
      /Bearer\s+(?!YOUR_API_KEY|\$AIRSCALE_API_KEY)[A-Za-z0-9_-]{20,}/,
      `${path} must not contain a non-placeholder bearer token`
    );
  }
});

test("internal documentation links resolve", () => {
  for (const path of PAGE_PATHS) {
    const { source } = readPage(path);
    const links = source.matchAll(/\[[^\]]*\]\((\/api-reference\/[^)\s?#]+)(?:[?#][^)]*)?\)/g);

    for (const [, href] of links) {
      assert.ok(existsSync(`.${href}.mdx`), `${path} link ${href} must resolve`);
    }
  }
});
