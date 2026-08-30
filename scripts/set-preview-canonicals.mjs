import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const publicationPolicy = JSON.parse(readFileSync("contracts/publication-policy.json", "utf8"));
export const PREVIEW_ORIGIN = publicationPolicy.previewOrigin;
const CONTENT_ROOTS = ["api-reference"];

export function mdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxFiles(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

export function canonicalFor(path, previewOrigin = PREVIEW_ORIGIN) {
  return `${previewOrigin}/${path.replace(/\.mdx$/, "")}`;
}

function descriptionEndIndex(lines, path) {
  const descriptionIndex = lines.findIndex((line) => line.startsWith("description:"));
  if (descriptionIndex < 0) throw new Error(`${path} must define description before canonical`);

  const value = lines[descriptionIndex].slice("description:".length).trim();
  if (!/^[|>](?:(?:[1-9][+-]?)|(?:[+-][1-9]?))?(?:\s+#.*)?$/.test(value)) {
    return descriptionIndex + 1;
  }

  let end = descriptionIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "" || /^\s+/.test(line)) {
      end += 1;
    } else {
      break;
    }
  }
  return end;
}

export function updateFrontmatterSource(path, source, previewOrigin = PREVIEW_ORIGIN) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} must start with YAML frontmatter`);

  const lines = match[1].split("\n").filter((line) => !line.startsWith("canonical:"));
  const canonical = `canonical: ${JSON.stringify(canonicalFor(path, previewOrigin))}`;
  const insertionIndex = descriptionEndIndex(lines, path);
  lines.splice(insertionIndex, 0, canonical);

  const nextFrontmatter = `---\n${lines.join("\n")}\n---`;
  const nextSource = source.replace(match[0], nextFrontmatter);
  const canonicalCount = lines.filter((line) => line.startsWith("canonical:")).length;
  if (canonicalCount !== 1) throw new Error(`${path} must define exactly one top-level canonical`);
  return { nextSource, changed: nextSource !== source };
}

export function synchronizeFiles(
  paths,
  { read = readFileSync, write = writeFileSync, previewOrigin = PREVIEW_ORIGIN } = {}
) {
  const plans = paths.map((path) => {
    const source = read(path, "utf8");
    return { path, source, ...updateFrontmatterSource(path, source, previewOrigin) };
  });

  for (const plan of plans) {
    if (plan.changed) write(plan.path, plan.nextSource);
  }

  return {
    scanned: plans.length,
    changed: plans.filter((plan) => plan.changed).length
  };
}

function run() {
  const files = CONTENT_ROOTS.flatMap(mdxFiles);
  const result = synchronizeFiles(files);
  console.log(`Scanned ${result.scanned} MDX pages; updated ${result.changed}.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run();
