import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const APPROVED_BEARER_VALUES = new Set([
  "YOUR_API_KEY",
  "$AIRSCALE_API_KEY",
  "${AIRSCALE_API_KEY}",
  "<YOUR_API_KEY>"
]);
const AUTHORIZATION_BEARER_VALUE = /\bAuthorization\b[\s:,"'`|=>(\[\]{}.fFrRuUbB-]*?\bBearer\s+(\S+)/gi;
const AIRSCALE_API_KEY_WRITE_TARGET = String.raw`(?:process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])|os\.environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\]|\bAIRSCALE_API_KEY\b)`;
const AIRSCALE_API_KEY_ASSIGNMENT = new RegExp(`${AIRSCALE_API_KEY_WRITE_TARGET}\\s*=(?!=)\\s*(?:(['"])([^'"\\r\\n]*)\\1|([^\\s;]+))`, "gi");

function stripBearerValue(value) {
  return value
    .trim()
    .replace(/^```(?:[a-z][a-z0-9_-]*)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
    .replace(/^&lt;(.+)&gt;$/, "<$1>")
    .replace(/["'`][)\]}>},;|.!?]*$/, "")
    .replace(/^["'`]+|[)\]"'`,;|.!?]+$/g, "")
    .trim();
}

function unwrapJavaScriptParentheses(expression) {
  let candidate = expression.trim();
  while (candidate.startsWith("(") && candidate.endsWith(")")) {
    let depth = 0;
    let closesBeforeEnd = false;
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate[index] === "(") depth += 1;
      if (candidate[index] === ")") depth -= 1;
      if (depth === 0 && index < candidate.length - 1) {
        closesBeforeEnd = true;
        break;
      }
      if (depth < 0) return candidate;
    }
    if (depth !== 0 || closesBeforeEnd) break;
    candidate = candidate.slice(1, -1).trim();
  }
  return candidate;
}

function isApprovedJavaScriptCredentialExpression(expression) {
  const candidate = unwrapJavaScriptParentheses(expression);
  if (/^process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])$/.test(candidate)) return true;
  const wrapper = candidate.match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(([\s\S]*)\)$/);
  if (!wrapper) return false;
  const argument = wrapper[1].trim();
  let depth = 0;
  for (const character of argument) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0 || (character === "," && depth === 0)) return false;
  }
  return depth === 0 && isApprovedJavaScriptCredentialExpression(argument);
}

function javascriptCredentialAssignments(source, variable) {
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = new RegExp(
    `(?<![.\\w$])(?:(?:const|let|var)\\s+)?${escapedVariable}\\s*(\\?\\?=|\\|\\|=|&&=|\\*\\*=|>>>=|>>=|<<=|[+\\-*/%&|^]=|=(?!=))\\s*([^;\\n]+)`,
    "g"
  );
  return Array.from(source.matchAll(assignment), ([, operator, expression]) => ({ operator, expression: expression.trim() }));
}

function isApprovedBearerValue(source, rawValue) {
  const value = stripBearerValue(rawValue);
  if (!value || value.toLowerCase() === "authentication") return true;
  if (APPROVED_BEARER_VALUES.has(value)) return true;
  if (/^\{os\.(?:environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\]|getenv\((?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\))\}$/.test(value)) return true;

  const javascriptExpression = value.match(/^\$\{([\s\S]+)\}$/)?.[1];
  if (!javascriptExpression) return false;
  if (isApprovedJavaScriptCredentialExpression(javascriptExpression)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(javascriptExpression)) return false;
  const assignments = javascriptCredentialAssignments(source, javascriptExpression);
  return assignments.length > 0 && assignments.every(({ operator, expression }) => (
    operator === "=" && isApprovedJavaScriptCredentialExpression(expression)
  ));
}

export function hasUnsafeBearerAuthorization(source) {
  const hasUnsafeAssignment = Array.from(source.matchAll(AIRSCALE_API_KEY_ASSIGNMENT)).some(([, , quotedValue, unquotedValue]) => {
    const value = (quotedValue ?? unquotedValue ?? "").trim();
    const isDynamicShellValue = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(value);
    const isDynamicEnvironmentValue = /^(?:process\.env(?:\.AIRSCALE_API_KEY|\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])|os\.environ\[(?:"AIRSCALE_API_KEY"|'AIRSCALE_API_KEY')\])$/.test(value);
    return Boolean(value) && !APPROVED_BEARER_VALUES.has(value) && !isDynamicShellValue && !isDynamicEnvironmentValue;
  });
  if (hasUnsafeAssignment) return true;
  return Array.from(source.matchAll(AUTHORIZATION_BEARER_VALUE)).some(([, value]) => !isApprovedBearerValue(source, value));
}

export function hasApprovedBearerCredentialSource(source) {
  const bearerValues = Array.from(source.matchAll(AUTHORIZATION_BEARER_VALUE), ([, value]) => value);
  return bearerValues.length > 0
    && !hasUnsafeBearerAuthorization(source)
    && bearerValues.every((value) => isApprovedBearerValue(source, value));
}

function documentationLinkTargets(source) {
  const targets = [];
  const routePattern = String.raw`\/(?:mcp|api-reference)\/(?:[^()\s?#]+|\([^()\s?#]*\))+`;
  const markdownRoute = new RegExp(`\\[[^\\]]*\\]\\((${routePattern})(?:\\?[^#)\\s]*)?(?:#([^\\s)]+))?\\)`, "g");
  for (const match of source.matchAll(markdownRoute)) {
    targets.push({ href: match[0], route: match[1], fragment: match[2] ?? null });
  }
  for (const match of source.matchAll(/\[[^\]]*\]\(#([^\s)]+)\)/g)) {
    targets.push({ href: match[0], route: null, fragment: match[1] });
  }

  const componentRoute = new RegExp(`<[A-Za-z][\\w.:-]*\\b[^>]*\\bhref=(["'])(${routePattern})(?:\\?[^"'#]*)?(?:#([^"']+))?\\1[^>]*>`, "g");
  for (const match of source.matchAll(componentRoute)) {
    targets.push({ href: match[0], route: match[2], fragment: match[3] ?? null });
  }
  for (const match of source.matchAll(/<[A-Za-z][\w.:-]*\b[^>]*\bhref=(["'])#([^"']+)\1[^>]*>/g)) {
    targets.push({ href: match[0], route: null, fragment: match[2] });
  }
  return targets;
}

export function localDocumentationLinks(source) {
  return documentationLinkTargets(source).filter(({ route }) => route !== null).map(({ route }) => route);
}

function headingSlug(heading) {
  return heading
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/&amp;/gi, " and ")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

function documentAnchors(source) {
  const anchors = new Set();
  for (const match of source.matchAll(/<a\b[^>]*\bid=(["'])([^"']+)\1[^>]*>/gi)) anchors.add(match[2]);

  const title = source.match(/^---\n[\s\S]*?^title:\s*["']?([^"'\n]+)["']?\s*$[\s\S]*?^---$/m)?.[1];
  if (title) anchors.add(headingSlug(title));

  const slugCounts = new Map();
  let inFence = false;
  for (const line of source.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = headingSlug(heading);
    if (!base) continue;
    const count = slugCounts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    slugCounts.set(base, count + 1);
  }
  return anchors;
}

export function assertLocalDocumentationLinksResolve(source, path) {
  for (const target of documentationLinkTargets(source)) {
    const targetPath = target.route ?? path;
    const filePath = target.route ? `.${targetPath}.mdx` : `${targetPath}.mdx`;
    assert.ok(existsSync(filePath), `${path} link ${target.route ?? `#${target.fragment}`} must resolve`);
    if (!target.fragment) continue;
    let fragment;
    try {
      fragment = decodeURIComponent(target.fragment);
    } catch {
      assert.fail(`${path} link fragment ${target.fragment} must be valid URL encoding`);
    }
    assert.ok(
      documentAnchors(readFileSync(filePath, "utf8")).has(fragment),
      `${path} link fragment ${fragment} must resolve in ${targetPath}`
    );
  }
}

export function assertBalancedCodeFences(source, path) {
  const fenceCount = (source.match(/^[\t ]*```/gm) ?? []).length;
  assert.equal(fenceCount % 2, 0, `${path} must have balanced code fences`);
}

export function assertNoStaticCredentials(source, path) {
  assert.doesNotMatch(source, /\b(?:sk|pk)_live_[A-Za-z0-9_-]+\b/i, `${path} must not contain live credentials`);
  assert.equal(hasUnsafeBearerAuthorization(source), false, `${path} must not contain a static Bearer credential`);
}
