// ───────────────────────────────────────────────────────────────────────────
// services/tags.ts — Tag-fragment expansion + parsing helpers (PURE).
//
// Tag fragments are named text macros (`PromptTag = { id, name, body }`, name
// stored WITHOUT the leading '#'). They are referenced from any prompt text
// field as `#name` and expanded ONLY at send-time by `resolveText()` inside
// `promptToV4Json()`. See Plan.md → "Tag fragments system".
//
// Token grammar: a tag reference is `#` immediately followed by a run of
// tag-name chars `[A-Za-z0-9_-]`. Names are case-sensitive. A bare `#` (not
// followed by a valid name char) is left literal, so real hashtags survive
// unless they collide with a defined tag name. Unknown `#tokens` are also left
// literal.
//
// Everything here is side-effect-free: no I/O, no mutation of inputs, no
// Math.random / Date.now. Kept pure so it's trivially testable later.
// ───────────────────────────────────────────────────────────────────────────

import type { PromptTag } from "../types";

/** Matches a `#name` reference; capture group 1 is the bare name. */
const TAG_TOKEN = /#([A-Za-z0-9_-]+)/g;

/** Validates a bare tag name (no '#'). */
const VALID_NAME = /^[A-Za-z0-9_-]+$/;

/** Hard backstop on recursion regardless of cycle detection. */
const DEFAULT_MAX_DEPTH = 10;

/**
 * Build a name→body lookup. When duplicate names exist, the FIRST occurrence
 * wins (names are expected unique per node; collisions are a UI warning).
 */
function buildTagMap(tags: PromptTag[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of tags) {
    if (!map.has(tag.name)) map.set(tag.name, tag.body);
  }
  return map;
}

/**
 * Recursively replace every `#name` token in `text` with the matching tag's
 * body. A tag body may itself reference other tags, so expansion recurses.
 *
 * - UNKNOWN tokens (no matching tag) are left LITERAL.
 * - CYCLE DETECTION: a token whose name is already on the active expansion
 *   stack is left as-is (the literal `#name`) instead of recursing — this
 *   breaks cycles without infinite looping.
 * - `maxDepth` (default 10) is a hard depth backstop; at depth 0 we stop
 *   recursing and leave any remaining tokens literal.
 *
 * Pure: does not mutate `text` or `tags`.
 */
export function resolveText(
  text: string,
  tags: PromptTag[],
  maxDepth: number = DEFAULT_MAX_DEPTH,
): string {
  const map = buildTagMap(tags);

  const expand = (input: string, depth: number, stack: Set<string>): string => {
    if (depth <= 0) return input;
    return input.replace(TAG_TOKEN, (match, name: string) => {
      // Unknown token → leave literal.
      if (!map.has(name)) return match;
      // Cycle: this name is already being expanded → leave literal.
      if (stack.has(name)) return match;

      const body = map.get(name)!;
      const nextStack = new Set(stack);
      nextStack.add(name);
      return expand(body, depth - 1, nextStack);
    });
  };

  return expand(text, maxDepth, new Set<string>());
}

/**
 * Returns the DISTINCT tag names referenced via `#name` in `text` (without the
 * '#'), in first-appearance order.
 */
export function extractTagRefs(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TAG_TOKEN)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Parse a single TagsPanel item string into `{ name, body }`. The FIRST
 * `#token` is the tag name; everything after it (trimmed) is the body.
 *
 *   "#colors1 bright orange with red" → { name: "colors1", body: "bright orange with red" }
 *   "  #foo  bar baz "               → { name: "foo", body: "bar baz" }
 *
 * If there is no leading `#token`, returns `{ name: "", body: line.trim() }`.
 */
export function parseTagLine(line: string): { name: string; body: string } {
  const trimmed = line.trim();
  const m = trimmed.match(/^#([A-Za-z0-9_-]+)\s*([\s\S]*)$/);
  if (!m) return { name: "", body: trimmed };
  return { name: m[1], body: m[2].trim() };
}

/**
 * Inverse-ish of `parseTagLine`: renders a tag back to its authored line.
 * `"#" + name + (body ? " " + body : "")`. If name is empty, returns just body.
 */
export function formatTagLine(tag: { name: string; body: string }): string {
  if (!tag.name) return tag.body;
  return "#" + tag.name + (tag.body ? " " + tag.body : "");
}

/** True iff `name` is a syntactically valid bare tag name. */
export function isValidTagName(name: string): boolean {
  return VALID_NAME.test(name);
}

/**
 * Returns referenced names that have NO matching tag (for flagging "undefined
 * tag" references in the UI), distinct, in first-appearance order.
 */
export function findUndefinedRefs(text: string, tags: PromptTag[]): string[] {
  const map = buildTagMap(tags);
  return extractTagRefs(text).filter((name) => !map.has(name));
}
