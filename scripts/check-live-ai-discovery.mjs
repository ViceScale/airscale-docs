import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// This opt-in smoke check only makes anonymous GET requests to documentation.
// Local generators cannot detect Mintlify dashboard domain-setting drift.
const { previewOrigin: origin } = JSON.parse(readFileSync(new URL("../contracts/publication-policy.json", import.meta.url), "utf8"));
// Mintlify's current default is .site; existing .app links remain supported.
const allowedOrigins = new Set([origin, origin.replace(/\.mintlify\.app$/, ".mintlify.site")]);
const pages = [
  "/api-reference/email-finder.md",
  "/api-reference/miscale-news/whatsapp-check.md",
  "/cli/overview.md",
  "/mcp/airscale-mcp-server.md",
  "/docs/sales-navigator.md",
];

async function get(path, headers = {}) {
  const response = await fetch(new URL(path, origin), { headers, signal: AbortSignal.timeout(20_000) });
  return { response, body: await response.text() };
}

async function checkIndex(body, label) {
  const index = body.match(/^> Fetch the (?:complete )?documentation index at:\s*(\S+)/mi)?.[1];
  assert.ok(index, `${label}: missing generated discovery link`);
  const url = new URL(index);
  assert.ok(allowedOrigins.has(url.origin) && url.pathname === "/llms.txt", `${label}: unexpected discovery URL ${index}`);
  const { response, body: indexBody } = await get(index);
  assert.equal(response.status, 200, `${label}: index must resolve`);
  assert.match(indexBody, /^# Airscale API/m, `${label}: expected Airscale documentation index`);
  assert.ok(indexBody.includes(`${origin}/api-reference/email-finder.md`), `${label}: index must contain usable page links`);
}

const checks = [
  ...pages.map(path => [path, async () => {
    const { response, body } = await get(path);
    assert.equal(response.status, 200, path);
    await checkIndex(body, path);
  }]),
  ["Accept: text/markdown", async () => {
    const { response, body } = await get("/api-reference/email-finder", { Accept: "text/markdown" });
    assert.equal(response.status, 200);
    await checkIndex(body, "content negotiation");
  }],
  ["Markdown 404 recovery", async () => {
    const { response, body } = await get("/__airscale_discovery_smoke_missing__.md");
    assert.equal(response.status, 404);
    await checkIndex(body, "404 recovery");
  }],
  ["Discovery assets", async () => {
    for (const path of ["/llms.txt", "/.well-known/llms.txt", "/llms-full.txt", "/.well-known/llms-full.txt"]) {
      const { response, body } = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(body, /^# Airscale API/m, `${path}: expected documentation, not an HTML error page`);
      assert.ok(body.includes(`${origin}/api-reference/email-finder.md`), `${path}: working page links`);
    }
  }],
];

let failures = 0;
for (let offset = 0; offset < checks.length; offset += 4) {
  const group = checks.slice(offset, offset + 4);
  const results = await Promise.allSettled(group.map(([, check]) => check()));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") console.log(`PASS ${group[index][0]}`);
    else {
      failures++;
      console.error(`FAIL ${group[index][0]}: ${result.reason.message}`);
    }
  });
}
console.log(`${checks.length - failures}/${checks.length} live AI discovery checks passed`);
process.exitCode = failures ? 1 : 0;
