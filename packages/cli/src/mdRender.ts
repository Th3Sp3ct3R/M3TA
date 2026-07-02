// Pure markdown → terminal renderer. NO Ink imports — this is plain data in,
// styled segments out, so it's unit-testable without a terminal. The TUI
// (inkTui.ts) maps these segments onto <Text> nodes; anything else can too.
//
// Design goals:
//   - Beat flat-text assistant output: headings, bold/italic, inline code,
//     fenced code blocks with lightweight syntax tinting, lists, blockquotes,
//     links.
//   - Robust to garbage: unterminated fences, empty input, CRLF, absurdly long
//     lines. Never throws. The caller handles wrapping/truncation.

/** The palette the renderer needs. A structural subset of the TUI's DeckTheme,
 *  so callers can pass their theme straight in. All fields are plain color
 *  strings (hex like "#ff6a44" or ANSI names like "cyan"). */
export interface MdTheme {
  text: string;
  dim: string;
  accent: string;
  accent2: string;
  accent3: string;
  success: string;
  warn: string;
  error: string;
}

/** One styled run of text within a line. `color` omitted = inherit default. */
export interface MdSpan {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
}

/** A single rendered terminal line: an ordered list of styled spans. An empty
 *  `spans` array is a blank line (preserved for spacing). `kind` lets the caller
 *  make layout decisions (e.g. no truncation inside code blocks). */
export interface MdLine {
  kind: "text" | "heading" | "code" | "code-fence" | "list" | "quote" | "blank";
  spans: MdSpan[];
}

/** Render raw markdown into styled terminal lines. Pure + total: never throws,
 *  always returns an array (possibly a single blank line for empty input). */
export function renderMarkdown(input: string, theme: MdTheme): MdLine[] {
  try {
    return renderMarkdownUnsafe(input, theme);
  } catch {
    // Absolute backstop — a bug in here must never take down a turn's output.
    // Fall back to flat text, split on newlines.
    const safe = typeof input === "string" ? input : String(input ?? "");
    return safe.split(/\r?\n/).map((line) => ({
      kind: "text" as const,
      spans: line ? [{ text: line, color: theme.text }] : [],
    }));
  }
}

function renderMarkdownUnsafe(input: string, theme: MdTheme): MdLine[] {
  if (input == null || input === "") return [{ kind: "blank", spans: [] }];
  const raw = String(input).replace(/\r\n?/g, "\n"); // normalize CRLF / lone CR
  const rows = raw.split("\n");
  const out: MdLine[] = [];

  let inFence = false;
  let fenceLang = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fence = matchFence(row);
    if (fence != null) {
      if (!inFence) {
        // Opening fence — emit a header line with the language label.
        inFence = true;
        fenceLang = fence.lang;
        out.push({
          kind: "code-fence",
          spans: [
            { text: "⌗ ", color: theme.dim },
            { text: fenceLang || "code", color: theme.accent3, bold: true },
          ],
        });
      } else {
        // Closing fence — swallow it, drop back to prose.
        inFence = false;
        fenceLang = "";
      }
      continue;
    }

    if (inFence) {
      out.push({ kind: "code", spans: highlightCode(row, fenceLang, theme) });
      continue;
    }

    out.push(renderProseLine(row, theme));
  }

  // Unterminated fence: the loop already emitted every buffered code line as
  // `kind: "code"`, so nothing is lost — we simply never saw a closer. No throw.
  return out.length ? out : [{ kind: "blank", spans: [] }];
}

/** A fence is ``` or ~~~ (3+), optionally indented, optionally with a lang tag. */
function matchFence(row: string): { lang: string } | null {
  const m = /^\s*(`{3,}|~{3,})\s*([^\s`~]*)/.exec(row);
  if (!m) return null;
  return { lang: (m[2] ?? "").trim().toLowerCase() };
}

function renderProseLine(row: string, theme: MdTheme): MdLine {
  if (row.trim() === "") return { kind: "blank", spans: [] };

  // Headings: #, ##, ### … → bold accent, level-scaled prefix.
  const heading = /^(#{1,6})\s+(.*)$/.exec(row);
  if (heading) {
    const level = heading[1].length;
    const body = heading[2];
    const prefix = level <= 2 ? "" : "  ".repeat(level - 2);
    const color = level === 1 ? theme.accent : level === 2 ? theme.accent2 : theme.accent3;
    return {
      kind: "heading",
      spans: [
        { text: prefix, color: theme.dim },
        ...renderInline(body, theme, { color, bold: true }),
      ],
    };
  }

  // Blockquote: > text (may nest with >>).
  const quote = /^(\s*>+\s?)(.*)$/.exec(row);
  if (quote) {
    return {
      kind: "quote",
      spans: [
        { text: "▏ ", color: theme.accent3 },
        ...renderInline(quote[2], theme, { color: theme.dim, italic: true }),
      ],
    };
  }

  // Bullet list: -, *, + → clean "•" marker, indent preserved.
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(row);
  if (bullet) {
    const indent = bullet[1].replace(/\t/g, "  ");
    return {
      kind: "list",
      spans: [
        { text: `${indent}• `, color: theme.accent },
        ...renderInline(bullet[2], theme, { color: theme.text }),
      ],
    };
  }

  // Numbered list: 1. / 1) → keep the number, normalize the separator.
  const numbered = /^(\s*)(\d{1,9})[.)]\s+(.*)$/.exec(row);
  if (numbered) {
    const indent = numbered[1].replace(/\t/g, "  ");
    return {
      kind: "list",
      spans: [
        { text: `${indent}${numbered[2]}. `, color: theme.accent },
        ...renderInline(numbered[3], theme, { color: theme.text }),
      ],
    };
  }

  // Horizontal rule: ---, ***, ___
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(row)) {
    return { kind: "text", spans: [{ text: "─".repeat(24), color: theme.dim }] };
  }

  return { kind: "text", spans: renderInline(row, theme, { color: theme.text }) };
}

interface InlineBase {
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

/** Parse inline markdown (bold/italic/code/links) into styled spans. Greedy but
 *  robust: unmatched markers render literally rather than eating the rest of the
 *  line. `base` is the surrounding style (e.g. heading = bold accent). */
function renderInline(text: string, theme: MdTheme, base: InlineBase): MdSpan[] {
  const spans: MdSpan[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      spans.push({ text: buf, color: base.color, bold: base.bold, italic: base.italic });
      buf = "";
    }
  };

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];

    // Inline code: `code` — accent2, never re-parsed for other markup.
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        spans.push({ text: text.slice(i + 1, end), color: theme.accent2 });
        i = end + 1;
        continue;
      }
    }

    // Link: [label](url) → label in accent, url dimmed in parens.
    if (ch === "[") {
      const link = matchLink(text, i);
      if (link) {
        flush();
        spans.push(...renderInline(link.label, theme, { ...base, color: theme.accent }));
        spans.push({ text: ` (${link.url})`, color: theme.dim });
        i = link.end;
        continue;
      }
    }

    // Bold: **x** or __x__
    if ((ch === "*" || ch === "_") && text[i + 1] === ch) {
      const marker = ch + ch;
      const end = text.indexOf(marker, i + 2);
      if (end > i + 1) {
        flush();
        spans.push(
          ...renderInline(text.slice(i + 2, end), theme, { ...base, bold: true }),
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: *x* or _x_ (single marker, non-empty, not touching the marker char)
    if ((ch === "*" || ch === "_") && text[i + 1] !== ch && text[i + 1] !== undefined) {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        spans.push(
          ...renderInline(text.slice(i + 1, end), theme, { ...base, italic: true }),
        );
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return spans.length ? spans : [{ text: "", color: base.color }];
}

/** Match a [label](url) link starting at `start` (text[start] === "["). Returns
 *  null if it's not a well-formed link (so the "[" renders literally). */
function matchLink(text: string, start: number): { label: string; url: string; end: number } | null {
  const close = text.indexOf("]", start + 1);
  if (close < 0 || text[close + 1] !== "(") return null;
  const urlEnd = text.indexOf(")", close + 2);
  if (urlEnd < 0) return null;
  const label = text.slice(start + 1, close);
  const url = text.slice(close + 2, urlEnd);
  if (!label || !url) return null;
  return { label, url, end: urlEnd + 1 };
}

// ─── Lightweight syntax tinting ──────────────────────────────────────────────
// Not a real parser — a small tokenizer that tints strings, comments, numbers,
// and a language-appropriate keyword set. Unknown languages fall through to a
// plain monospace color. Robust: any failure yields flat code color.

const KEYWORDS: Record<string, RegExp> = {
  js: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|export|from|default|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|null|undefined|true|false)\b/,
  ts: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|export|from|default|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|null|undefined|true|false|interface|type|enum|implements|readonly|public|private|protected|as|namespace|declare|keyof|infer)\b/,
  py: /\b(def|return|if|elif|else|for|while|break|continue|class|import|from|as|pass|lambda|with|yield|try|except|finally|raise|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|async|await|self)\b/,
  rust: /\b(fn|let|mut|const|return|if|else|match|for|while|loop|break|continue|struct|enum|impl|trait|pub|use|mod|crate|self|super|as|where|move|ref|dyn|async|await|unsafe|type|static|true|false)\b/,
  bash: /\b(if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|local|export|readonly|declare|echo|cd|source|exit|set|unset|test)\b/,
};

// Language alias table → canonical keyword bucket.
const LANG_ALIAS: Record<string, string> = {
  javascript: "js",
  jsx: "js",
  node: "js",
  typescript: "ts",
  tsx: "ts",
  python: "py",
  py3: "py",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
};

/** Tint one line of code. `lang` selects the keyword set; json gets key/value
 *  tinting; unknown langs render plain. Never throws. */
function highlightCode(line: string, lang: string, theme: MdTheme): MdSpan[] {
  if (line === "") return [{ text: "", color: theme.text }];
  try {
    const canon = LANG_ALIAS[lang] ?? lang;
    if (canon === "json") return highlightJson(line, theme);
    const kw = KEYWORDS[canon];
    return tokenizeCode(line, theme, kw);
  } catch {
    return [{ text: line, color: theme.text }];
  }
}

/** Generic tokenizer: comments, strings, numbers, then optional keywords.
 *  Walks char-by-char so it can't be tripped by pathological input. */
function tokenizeCode(line: string, theme: MdTheme, kw: RegExp | undefined): MdSpan[] {
  const spans: MdSpan[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    if (kw) {
      // Re-scan the plain run for keywords, splitting around them.
      let rest = buf;
      let guard = 0;
      while (rest && guard++ < 1000) {
        const m = kw.exec(rest);
        if (!m || m.index == null) {
          spans.push({ text: rest, color: theme.text });
          break;
        }
        if (m.index > 0) spans.push({ text: rest.slice(0, m.index), color: theme.text });
        spans.push({ text: m[0], color: theme.accent, bold: true });
        rest = rest.slice(m.index + m[0].length);
      }
      if (guard >= 1000 && rest) spans.push({ text: rest, color: theme.text });
    } else {
      spans.push({ text: buf, color: theme.text });
    }
    buf = "";
  };

  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    const two = line.slice(i, i + 2);

    // Line comments: //  #  --
    if (two === "//" || ch === "#" || two === "--") {
      flush();
      spans.push({ text: line.slice(i), color: theme.dim, italic: true });
      break;
    }

    // Strings: '...', "...", `...`
    if (ch === '"' || ch === "'" || ch === "`") {
      flush();
      let j = i + 1;
      while (j < n && line[j] !== ch) {
        if (line[j] === "\\") j++; // skip escaped char
        j++;
      }
      const strEnd = Math.min(j + 1, n);
      spans.push({ text: line.slice(i, strEnd), color: theme.success });
      i = strEnd;
      continue;
    }

    // Numbers: 123, 1.5, 0xFF, 1e9
    if (/[0-9]/.test(ch) && !/[A-Za-z_]/.test(line[i - 1] ?? " ")) {
      flush();
      const m = /^(0x[0-9a-fA-F]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?)/.exec(line.slice(i));
      if (m) {
        spans.push({ text: m[0], color: theme.accent2 });
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return spans.length ? spans : [{ text: line, color: theme.text }];
}

/** JSON tinting: "keys" before a colon in accent, string values in success,
 *  numbers/booleans/null in accent2. Falls back gracefully. */
function highlightJson(line: string, theme: MdTheme): MdSpan[] {
  const spans: MdSpan[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') {
        if (line[j] === "\\") j++;
        j++;
      }
      const end = Math.min(j + 1, n);
      const str = line.slice(i, end);
      // Look ahead past whitespace for a colon → it's a key.
      let k = end;
      while (k < n && /\s/.test(line[k])) k++;
      const isKey = line[k] === ":";
      spans.push({ text: str, color: isKey ? theme.accent : theme.success, bold: isKey });
      i = end;
      continue;
    }
    if (/[0-9-]/.test(ch) && !/[A-Za-z]/.test(line[i - 1] ?? " ")) {
      const m = /^-?\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?/.exec(line.slice(i));
      if (m) {
        spans.push({ text: m[0], color: theme.accent2 });
        i += m[0].length;
        continue;
      }
    }
    const kw = /^(true|false|null)\b/.exec(line.slice(i));
    if (kw && !/[A-Za-z_]/.test(line[i - 1] ?? " ")) {
      spans.push({ text: kw[0], color: theme.accent2, bold: true });
      i += kw[0].length;
      continue;
    }
    spans.push({ text: ch, color: theme.dim });
    i++;
  }
  return spans.length ? spans : [{ text: line, color: theme.text }];
}

/** True if the string plausibly contains markdown worth rich-rendering. Plain
 *  chat text renders identically either way, but this lets the caller skip the
 *  work entirely for obviously-flat text. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|`{3})|`[^`]+`|\*\*|__|\*[^*\s]|\[[^\]]+\]\(/.test(text);
}
