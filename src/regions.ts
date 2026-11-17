// Text analysis for Vascula templates. Pure functions over strings and offsets,
// so they can be tested without VS Code.

export interface SchemaBlock {
  /** Offset of the `{%` that opens `{% schema %}`. */
  tagStart: number;
  /** Offset just after the opening tag: where the JSON starts. */
  contentStart: number;
  /** Offset of the `{%` that opens `{% endschema %}`, or the end of the text when it is missing. */
  contentEnd: number;
  /** Offset just after `{% endschema %}`. */
  tagEnd: number;
  closed: boolean;
}

const COMMENT_TAG = /\{%-?\s*comment\s*-?%\}[\s\S]*?(?:\{%-?\s*endcomment\s*-?%\}|$)/g;
const INLINE_COMMENT = /\{#[\s\S]*?(?:#\}|$)/g;

/** Replaces comments with spaces, keeping line breaks so offsets stay put. */
export function maskComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\r\n]/g, " ");
  return text.replace(COMMENT_TAG, blank).replace(INLINE_COMMENT, blank);
}

export function findSchemaBlocks(text: string): SchemaBlock[] {
  const masked = maskComments(text);
  const blocks: SchemaBlock[] = [];
  const open = /\{%-?\s*schema\s*-?%\}/g;
  const close = /\{%-?\s*endschema\s*-?%\}/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(masked))) {
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(masked);
    blocks.push({
      tagStart: m.index,
      contentStart: m.index + m[0].length,
      contentEnd: c ? c.index : text.length,
      tagEnd: c ? c.index + c[0].length : text.length,
      closed: !!c,
    });
    if (!c) break;
    open.lastIndex = c.index + c[0].length;
  }
  return blocks;
}

/** The text with everything but one schema block's JSON blanked, offsets unchanged. */
export function virtualJson(text: string, block: SchemaBlock): string {
  const before = text.slice(0, block.contentStart).replace(/[^\r\n]/g, " ");
  const after = text.slice(block.contentEnd).replace(/[^\r\n]/g, " ");
  return before + text.slice(block.contentStart, block.contentEnd) + after;
}

export function schemaBlockAt(text: string, offset: number): SchemaBlock | undefined {
  return findSchemaBlocks(text).find((b) => offset >= b.contentStart && offset <= b.contentEnd);
}

export interface Markup {
  kind: "output" | "tag";
  /** Offset of the opening delimiter. */
  start: number;
  /** Offset where the markup's content starts (after the delimiter and any `-`). */
  contentStart: number;
  /** The content from contentStart up to the queried offset. */
  before: string;
  /** Whether the offset sits inside a string literal. */
  inString: boolean;
}

/** The `{{ }}` or `{% %}` markup that contains the offset, if any. */
export function markupAt(text: string, offset: number): Markup | undefined {
  const masked = maskComments(text);
  if (findSchemaBlocks(text).some((b) => offset > b.contentStart && offset < b.contentEnd)) return undefined;
  const head = masked.slice(0, offset);
  const lastOutput = head.lastIndexOf("{{");
  const lastTag = head.lastIndexOf("{%");
  const start = Math.max(lastOutput, lastTag);
  if (start < 0) return undefined;
  const kind = start === lastOutput ? "output" : "tag";
  let contentStart = start + 2;
  if (masked[contentStart] === "-") contentStart++;
  const before = masked.slice(contentStart, offset);
  // Walk the content to find closers and strings.
  let quote: string | null = null;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (kind === "output" && ch === "}" && before[i + 1] === "}") return undefined;
    else if (kind === "tag" && ch === "%" && before[i + 1] === "}") return undefined;
  }
  return { kind, start, contentStart, before, inString: quote !== null };
}

/** `|` followed by an optional partial filter name at the end of the markup text. */
export function filterPrefix(m: Markup): string | undefined {
  if (m.inString) return undefined;
  const r = /\|\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(m.before);
  return r ? r[1] ?? "" : undefined;
}

/** A partial tag name directly after `{%`. */
export function tagNamePrefix(m: Markup): string | undefined {
  if (m.kind !== "tag" || m.inString) return undefined;
  const r = /^\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(m.before);
  return r ? r[1] ?? "" : undefined;
}

/** The partial kind inside `{% form "` . */
export function formKindPrefix(m: Markup): string | undefined {
  if (m.kind !== "tag" || !m.inString) return undefined;
  const r = /^\s*form\s+["']([A-Za-z0-9_]*)$/.exec(m.before);
  return r ? r[1] : undefined;
}

/**
 * A dotted path ending at the cursor, such as `product.price.` → ["product", "price"]
 * with an empty partial. Bracket indexes become "[]".
 */
export function pathBeforeCursor(m: Markup): { path: string[]; partial: string } | undefined {
  if (m.inString) return undefined;
  const r = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]*\])*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(m.before);
  if (!r) return undefined;
  if (r.index > 0 && /[A-Za-z0-9_.\]]/.test(m.before[r.index - 1])) return undefined;
  const path = r[1].replace(/\[[^\]]*\]/g, ".[]").split(".");
  return { path, partial: r[2] ?? "" };
}

/** Whether the word starting at `wordStart` follows a filter pipe. */
export function isFilterName(text: string, wordStart: number): boolean {
  let i = wordStart - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i--;
  return i >= 0 && text[i] === "|" && text[i - 1] !== "|";
}

/** Whether the word starting at `wordStart` is the first segment of a path (not after a dot). */
export function isPathHead(text: string, wordStart: number): boolean {
  const prev = text[wordStart - 1];
  return prev !== "." && !isFilterName(text, wordStart);
}

/** Offsets of `{% blocks %}` tags outside comments and schema. */
export function blocksTagOffsets(text: string): number[] {
  const masked = maskComments(text);
  const out: number[] = [];
  const re = /\{%-?\s*blocks\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) out.push(m.index);
  return out;
}
