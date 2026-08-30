import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const PREVIEW_ORIGIN = "https://airscale.mintlify.app";
const CONTENT_ROOTS = ["api-reference"];

function mdxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return mdxFiles(path);
      return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
    })
    .sort();
}

function canonicalFor(path) {
  return `${PREVIEW_ORIGIN}/${path.replace(/\.mdx$/, "")}`;
}

function updateFrontmatter(path) {
  const source = readFileSync(path, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`${path} must start with YAML frontmatter`);

  const lines = match[1].split("\n");
  const canonical = `canonical: ${JSON.stringify(canonicalFor(path))}`;
  const currentIndex = lines.findIndex((line) => line.startsWith("canonical:"));

  if (currentIndex >= 0) {
    lines[currentIndex] = canonical;
  } else {
    const descriptionIndex = lines.findIndex((line) => line.startsWith("description:"));
    if (descriptionIndex < 0) throw new Error(`${path} must define description before canonical`);
    lines.splice(descriptionIndex + 1, 0, canonical);
  }

  const nextFrontmatter = `---\n${lines.join("\n")}\n---`;
  const nextSource = source.replace(match[0], nextFrontmatter);
  if (nextSource !== source) writeFileSync(path, nextSource);
}

const files = CONTENT_ROOTS.flatMap(mdxFiles);
for (const path of files) updateFrontmatter(path);
console.log(`Updated preview canonicals for ${files.length} MDX pages.`);
