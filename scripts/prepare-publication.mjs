import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { updateFrontmatterSource } from "./set-preview-canonicals.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const readJson = (root, path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
export function routeCoverage(root = ROOT, config = readJson(root, "docs.json"), apiOnly = false) {
  const inventory = readJson(root, "inventory/framer-routes.json");
  const redirects = new Map((config.redirects ?? []).map(({ source, destination }) => [source, destination]));
  const rows = inventory.routes.filter(({ category }) => !apiOnly || category === "api-reference");
  for (const row of rows) {
    if (row.disposition === "omit" || !row.targetPath) throw new Error(`API route would disappear: ${row.path}`);
    if (row.path !== row.targetPath && redirects.get(row.path) !== row.targetPath) throw new Error(`Missing redirect: ${row.path}`);
    if (!existsSync(resolve(root, row.targetPath === "/" ? "index.mdx" : `${row.targetPath.slice(1)}.mdx`))) throw new Error(`Missing target: ${row.targetPath}`);
  }
  return rows.map(({ path, targetPath }) => ({ source: path, destination: targetPath, behavior: path === targetPath ? "page" : "redirect" }));
}
export function apiRouteCoverage(root = ROOT, config = readJson(root, "docs.json")) {
  return routeCoverage(root, config, true);
}
export function publicationConfig(root = ROOT) {
  const policy = readJson(root, "contracts/publication-policy.json");
  const config = readJson(root, "docs.json");
  if (config.seo?.metatags?.robots !== policy.previewRobots) throw new Error("Source must remain a noindex preview");
  config.seo.metatags.robots = "index, follow";
  config.seo.metatags.canonical = policy.liveDocumentationOrigin;
  const inventory = readJson(root, "inventory/framer-routes.json");
  const redirects = inventory.routes.filter((row) => row.category === "api-reference" && row.disposition === "consolidate")
    .map(({ path, targetPath }) => ({ source: path, destination: targetPath, permanent: true }));
  config.redirects = [...(config.redirects ?? []), ...redirects];
  if (new Set(config.redirects.map(({ source }) => source)).size !== config.redirects.length) throw new Error("Duplicate redirect source");
  routeCoverage(root, config);
  return config;
}
function walk(root, folder) {
  if (!existsSync(resolve(root, folder))) return [];
  return readdirSync(resolve(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Publication source cannot contain a symlink: ${path}`);
    return entry.isDirectory() ? walk(root, path) : [path];
  }).sort();
}
function contentPaths(root) {
  return ["api-reference", "docs", "mcp", "cli", "usecases"].flatMap((folder) => walk(root, folder).filter((path) => path.endsWith(".mdx")));
}
export function renderPublication(root = ROOT, { staging = false } = {}) {
  const policy = readJson(root, "contracts/publication-policy.json");
  if (policy.previewOrigin !== "https://airscale.mintlify.app" || policy.liveDocumentationOrigin !== "https://docs.airscale.io") throw new Error("Unexpected publication origins");
  const files = new Map();
  const config = publicationConfig(root);
  const documentationOrigin = staging ? policy.previewOrigin : policy.liveDocumentationOrigin;
  if (staging) {
    config.seo.metatags.robots = policy.previewRobots;
    config.seo.metatags.canonical = documentationOrigin;
  }
  const textPaths = ["index.mdx", ...contentPaths(root), "openapi.json", "llms.txt", "llms-full.txt", "skill.md", "mcp-tools.txt", "custom.css", "custom.js"];
  for (const path of textPaths) {
    let text = readFileSync(resolve(root, path), "utf8");
    if (path.endsWith(".mdx")) text = updateFrontmatterSource(path, text, documentationOrigin).nextSource;
    if (!staging) text = text.replaceAll(policy.previewOrigin, policy.liveDocumentationOrigin)
      .replaceAll("airscale.mintlify.app", "docs.airscale.io")
      .replace("> Preview documentation is intentionally noindex. Use only the docs.airscale.io links in this file.", "> Official Airscale documentation at docs.airscale.io.")
      .replace("> This is the full public, navigable preview corpus. It remains intentionally noindex for traditional search engines.", "> This is the full public, navigable Airscale documentation corpus.")
      .replace("This preview renders non-executing examples.", "This page renders non-executing examples.");
    files.set(path, Buffer.from(text));
  }
  for (const path of ["favicon.svg", ...["images", "logo", "videos"].flatMap((folder) => walk(root, folder))]) {
    files.set(path, readFileSync(resolve(root, path)));
  }
  files.set("docs.json", Buffer.from(JSON.stringify(config, null, 2) + "\n"));
  const pagePaths = [...new Set([
    ...config.navigation.tabs.flatMap(tab => tab.groups.flatMap(group => group.pages)).map(path => path === "index" ? "/" : `/${path}`),
    ...routeCoverage(root, config).map(row => row.destination)
  ])].sort();
  const xmlEscape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  files.set("sitemap.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pagePaths.map(path => `  <url><loc>${xmlEscape(documentationOrigin + path)}</loc></url>`).join("\n")}\n</urlset>\n`));
  files.set("robots.txt", Buffer.from(`User-agent: *\nAllow: /\nDisallow: /_next/\nAllow: /_next/image\nDisallow: /cdn-cgi/\n\nSitemap: ${documentationOrigin}/sitemap.xml\n`));
  const manifest = {
    documentationOrigin,
    indexing: staging ? "noindex" : "index",
    apiOrigin: "https://api.airscale.io",
    apiRoutes: apiRouteCoverage(root, config),
    routes: routeCoverage(root, config),
    indexablePages: pagePaths,
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, createHash("sha256").update(data).digest("hex")]))
  };
  files.set("publication-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return files;
}
export function preparePublication(output, { root = ROOT, staging = false } = {}) {
  if (!output || !isAbsolute(output)) throw new Error("Provide an absolute output directory");
  const target = resolve(output);
  // Never write over this repository, its ancestors, or an existing directory.
  if (target === resolve(root) || resolve(root).startsWith(target + sep)) throw new Error("Output cannot replace the source repository");
  if (existsSync(target)) throw new Error("Output already exists; choose a new directory");
  const files = renderPublication(root, { staging }); // Validate everything before creating output.
  mkdirSync(target, { recursive: true });
  for (const [path, data] of files) {
    const destination = resolve(target, path);
    if (relative(target, destination).startsWith("..")) throw new Error("Output path escapes publication directory");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, data, { flag: "wx" });
  }
  return { directory: target, files: files.size, apiRoutes: apiRouteCoverage(root, publicationConfig(root)).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const staging = args[0] === "--staging";
    if (staging) args.shift();
    if (args.length === 1 && args[0] === "--check") {
      const files = renderPublication(ROOT, { staging });
      process.stdout.write(`Publication candidate verified: ${files.size} files; ${apiRouteCoverage(ROOT, publicationConfig()).length} legacy API routes preserved. No files or network settings changed.\n`);
    } else if (args.length === 2 && args[0] === "--out") {
      process.stdout.write(JSON.stringify(preparePublication(args[1], { staging }), null, 2) + "\n");
    } else throw new Error("Usage: node scripts/prepare-publication.mjs [--staging] --check | --out /absolute/new/directory");
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
