// Unit tests for the pure markdown → terminal renderer (packages/cli/src/mdRender.ts).
// The renderer is Ink-free, so we test its structured output directly — no terminal.
// Run: pnpm --filter @ares/cli build && node --test tests/md-render.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown, looksLikeMarkdown } from "../packages/cli/dist/mdRender.js";

// A stand-in theme with distinct, recognizable color tokens so assertions can
// check that the renderer picked the right role color.
const THEME = {
  text: "TEXT",
  dim: "DIM",
  accent: "ACCENT",
  accent2: "ACCENT2",
  accent3: "ACCENT3",
  success: "SUCCESS",
  warn: "WARN",
  error: "ERROR",
};

/** Flatten every span's text across all lines into one string. */
function flatText(lines) {
  return lines.map((l) => l.spans.map((s) => s.text).join("")).join("\n");
}

/** All spans across all lines. */
function allSpans(lines) {
  return lines.flatMap((l) => l.spans);
}

test("bold text produces a bold span", () => {
  const lines = renderMarkdown("this is **loud** text", THEME);
  const bold = allSpans(lines).find((s) => s.text === "loud");
  assert.ok(bold, "expected a span containing 'loud'");
  assert.equal(bold.bold, true);
  // Surrounding text is present and not swallowed.
  assert.match(flatText(lines), /this is loud text/);
});

test("italic text produces an italic span", () => {
  const lines = renderMarkdown("a *soft* word", THEME);
  const it = allSpans(lines).find((s) => s.text === "soft");
  assert.ok(it, "expected a span containing 'soft'");
  assert.equal(it.italic, true);
});

test("inline code is tinted with the accent2 color", () => {
  const lines = renderMarkdown("run `npm test` now", THEME);
  const code = allSpans(lines).find((s) => s.text === "npm test");
  assert.ok(code, "expected inline code span");
  assert.equal(code.color, THEME.accent2);
});

test("fenced code block with a language emits a fence header and code lines", () => {
  const src = ["```ts", "const x = 1;", "```"].join("\n");
  const lines = renderMarkdown(src, THEME);
  const fence = lines.find((l) => l.kind === "code-fence");
  assert.ok(fence, "expected a code-fence header line");
  assert.match(fence.spans.map((s) => s.text).join(""), /ts/);
  const code = lines.filter((l) => l.kind === "code");
  assert.equal(code.length, 1, "one line of code between the fences");
  assert.match(code[0].spans.map((s) => s.text).join(""), /const x = 1;/);
  // The closing fence must be swallowed (not rendered as literal ```).
  assert.ok(!flatText(lines).includes("```"), "closing fence should not appear literally");
});

test("code syntax tinting colors keywords, strings, and numbers distinctly", () => {
  const src = ["```js", 'const name = "ares"; // hi', "```"].join("\n");
  const lines = renderMarkdown(src, THEME);
  const code = lines.find((l) => l.kind === "code");
  const spans = code.spans;
  assert.ok(spans.some((s) => s.text.includes("const") && s.color === THEME.accent), "keyword tinted");
  assert.ok(spans.some((s) => s.text.includes('"ares"') && s.color === THEME.success), "string tinted");
  assert.ok(spans.some((s) => s.color === THEME.dim && s.text.includes("// hi")), "comment tinted");
});

test("heading renders bold with an accent color", () => {
  const lines = renderMarkdown("# Title", THEME);
  const heading = lines.find((l) => l.kind === "heading");
  assert.ok(heading, "expected a heading line");
  const titleSpan = heading.spans.find((s) => s.text === "Title");
  assert.ok(titleSpan);
  assert.equal(titleSpan.bold, true);
  assert.equal(titleSpan.color, THEME.accent);
});

test("bulleted list gets a clean marker and list kind", () => {
  const src = ["- first", "- second"].join("\n");
  const lines = renderMarkdown(src, THEME);
  const list = lines.filter((l) => l.kind === "list");
  assert.equal(list.length, 2);
  assert.match(list[0].spans[0].text, /•/);
  assert.match(flatText(lines), /first/);
  assert.match(flatText(lines), /second/);
});

test("numbered list preserves the number", () => {
  const lines = renderMarkdown("1. alpha\n2. beta", THEME);
  const list = lines.filter((l) => l.kind === "list");
  assert.equal(list.length, 2);
  assert.match(list[0].spans[0].text, /1\./);
  assert.match(list[1].spans[0].text, /2\./);
});

test("blockquote renders as a quote line", () => {
  const lines = renderMarkdown("> quoted", THEME);
  const quote = lines.find((l) => l.kind === "quote");
  assert.ok(quote);
  assert.match(flatText(lines), /quoted/);
});

test("link renders label plus dimmed url in parens", () => {
  const lines = renderMarkdown("see [docs](https://x.io)", THEME);
  const flat = flatText(lines);
  assert.match(flat, /docs/);
  assert.match(flat, /\(https:\/\/x\.io\)/);
  const urlSpan = allSpans(lines).find((s) => s.text.includes("https://x.io"));
  assert.equal(urlSpan.color, THEME.dim);
});

// ─── Robustness: malformed / edge-case input must never throw ─────────────────

test("empty input returns a single blank line and does not throw", () => {
  let lines;
  assert.doesNotThrow(() => {
    lines = renderMarkdown("", THEME);
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "blank");
});

test("unterminated code fence does not throw and keeps the code", () => {
  const src = ["```py", "x = 1", "still code"].join("\n");
  let lines;
  assert.doesNotThrow(() => {
    lines = renderMarkdown(src, THEME);
  });
  const code = lines.filter((l) => l.kind === "code");
  assert.equal(code.length, 2, "both lines after the open fence render as code");
});

test("CRLF input is normalized without throwing", () => {
  const lines = renderMarkdown("a\r\nb\r\n", THEME);
  assert.doesNotThrow(() => flatText(lines));
  assert.match(flatText(lines), /a/);
  assert.match(flatText(lines), /b/);
});

test("null / non-string input does not throw", () => {
  assert.doesNotThrow(() => renderMarkdown(null, THEME));
  assert.doesNotThrow(() => renderMarkdown(undefined, THEME));
});

test("unmatched inline markers render literally, not swallowed", () => {
  const lines = renderMarkdown("a ** dangling and *lonely", THEME);
  // Should not throw and should preserve the visible characters.
  assert.match(flatText(lines), /dangling/);
  assert.match(flatText(lines), /lonely/);
});

test("extremely long line does not throw", () => {
  const long = "word ".repeat(5000);
  assert.doesNotThrow(() => renderMarkdown(long, THEME));
});

test("looksLikeMarkdown detects markdown and ignores plain text", () => {
  assert.equal(looksLikeMarkdown("# heading"), true);
  assert.equal(looksLikeMarkdown("has `code` inline"), true);
  assert.equal(looksLikeMarkdown("**bold**"), true);
  assert.equal(looksLikeMarkdown("just a plain sentence."), false);
  assert.equal(looksLikeMarkdown(""), false);
});

test("plain text renders as a single text line unchanged", () => {
  const lines = renderMarkdown("just a normal sentence", THEME);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "text");
  assert.equal(flatText(lines), "just a normal sentence");
});
