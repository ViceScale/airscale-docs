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

export function updateFrontmatterSource(path, source, previewOrigin = PREVIEW_ORIGIN) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} must start with YAML frontmatter`);

  const lines = match[1].split("\n");
  if (!lines.some((line) => line.startsWith("description:"))) {
    throw new Error(`${path} must define description before canonical`);
  }
  const canonical = `canonical: ${JSON.stringify(canonicalFor(path, previewOrigin))}`;
  const canonicalIndices = lines.reduce(
    (indices, line, index) => (line.startsWith("canonical:") ? [...indices, index] : indices),
    []
  );
  let nextLines;

  if (canonicalIndices.length === 0) {
    nextLines = [...lines, canonical];
  } else if (canonicalIndices.length === 1) {
    nextLines = lines.map((line) => (line.startsWith("canonical:") ? canonical : line));
  } else {
    let keptCanonical = false;
    nextLines = lines.flatMap((line) => {
      if (!line.startsWith("canonical:")) return [line];
      if (keptCanonical) return [];
      keptCanonical = true;
      return [canonical];
    });
  }

  const nextFrontmatter = `---\n${nextLines.join("\n")}\n---`;
  const nextSource = source.replace(match[0], nextFrontmatter);
  const canonicalCount = nextLines.filter((line) => line.startsWith("canonical:")).length;
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
