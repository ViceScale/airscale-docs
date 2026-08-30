import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMap, isScalar, parseDocument } from "yaml";

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

function parseFrontmatter(path, frontmatter, phase) {
  const document = parseDocument(frontmatter, { uniqueKeys: false });
  if (document.errors.length > 0) {
    throw new Error(`${path} ${phase} frontmatter must be valid YAML: ${document.errors[0].message}`);
  }
  if (!isMap(document.contents)) {
    throw new Error(`${path} ${phase} frontmatter must be a top-level YAML mapping`);
  }
  return document.contents;
}

function topLevelPairs(document, key) {
  return document.items.filter((pair) => isScalar(pair.key) && pair.key.value === key);
}

function lineBounds(source, offset) {
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return { start, end: end < 0 ? source.length : end, next: end < 0 ? source.length : end + 1 };
}

function assertSimpleCanonical(path, frontmatter, pair) {
  if (
    !isScalar(pair.value) ||
    pair.value.range === undefined ||
    pair.value.anchor !== undefined ||
    pair.value.tag !== undefined ||
    !["PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE"].includes(pair.value.type)
  ) {
    throw new Error(`${path} canonical must be a single-line scalar`);
  }

  const valueSource = frontmatter.slice(pair.value.range[0], pair.value.range[1]);
  const bounds = lineBounds(frontmatter, pair.key.range[0]);
  if (valueSource.includes("\n") || pair.key.range[0] !== bounds.start) {
    throw new Error(`${path} canonical must be a single-line scalar`);
  }
}

function replaceRange(source, start, end, replacement) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function updateFrontmatterSource(path, source, previewOrigin = PREVIEW_ORIGIN) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} must start with YAML frontmatter`);

  const frontmatter = match[1];
  const document = parseFrontmatter(path, frontmatter, "input");
  if (topLevelPairs(document, "description").length === 0) {
    throw new Error(`${path} must define description before canonical`);
  }
  const canonical = `canonical: ${JSON.stringify(canonicalFor(path, previewOrigin))}`;
  const canonicalPairs = topLevelPairs(document, "canonical");
  canonicalPairs.forEach((pair) => assertSimpleCanonical(path, frontmatter, pair));
  let nextFrontmatter;

  if (canonicalPairs.length === 0) {
    nextFrontmatter = `${frontmatter}\n${canonical}`;
  } else if (canonicalPairs.length === 1) {
    const pair = canonicalPairs[0];
    nextFrontmatter = replaceRange(frontmatter, pair.value.range[0], pair.value.range[1], JSON.stringify(canonicalFor(path, previewOrigin)));
  } else {
    nextFrontmatter = frontmatter;
    for (const pair of canonicalPairs.slice(1).reverse()) {
      const bounds = lineBounds(nextFrontmatter, pair.key.range[0]);
      nextFrontmatter = `${nextFrontmatter.slice(0, bounds.start)}${nextFrontmatter.slice(bounds.next)}`;
    }
    const first = canonicalPairs[0];
    nextFrontmatter = replaceRange(nextFrontmatter, first.value.range[0], first.value.range[1], JSON.stringify(canonicalFor(path, previewOrigin)));
  }

  const generatedDocument = parseFrontmatter(path, nextFrontmatter, "generated");
  const generatedCanonicals = topLevelPairs(generatedDocument, "canonical");
  if (generatedCanonicals.length !== 1 || !isScalar(generatedCanonicals[0].value) || generatedCanonicals[0].value.value !== canonicalFor(path, previewOrigin)) {
    throw new Error(`${path} generated frontmatter must define exactly one exact top-level canonical`);
  }

  const nextSource = source.replace(match[0], `---\n${nextFrontmatter}\n---`);
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
