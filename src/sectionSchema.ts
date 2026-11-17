// Validation, completion and hovers for the `{% schema %}` block of a .vasc file.
// Works on plain text and LSP types so it runs without VS Code (see test/unit).

import {
  getLanguageService,
  TextDocument,
  type Diagnostic,
  DiagnosticSeverity,
  type Position,
  type CompletionList,
  type Hover,
  type LanguageService,
} from "vscode-json-languageservice";
import { findSchemaBlocks, virtualJson, blocksTagOffsets, type SchemaBlock } from "./regions";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const strictSchema = require("../schemas/section.schema.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const advisorySchema = require("../schemas/section.advisory.schema.json");

function service(schema: unknown, uri: string): LanguageService {
  const ls = getLanguageService({});
  ls.configure({
    validate: true,
    allowComments: false,
    schemas: [{ uri, fileMatch: ["*"], schema: schema as never }],
  });
  return ls;
}

const strict = service(strictSchema, "vascula:section.schema.json");
const advisory = service(advisorySchema, "vascula:section.advisory.schema.json");

export interface Options {
  /** Report documented rules that uploads do not enforce, as warnings. */
  hints: boolean;
  /** The file's path, used for the block-name check. */
  path?: string;
}

function docFor(uri: string, text: string, block: SchemaBlock): TextDocument {
  return TextDocument.create(uri, "json", 1, virtualJson(text, block));
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function positionAt(starts: number[], offset: number): Position {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

function diag(starts: number[], start: number, end: number, message: string, severity: DiagnosticSeverity): Diagnostic {
  return { range: { start: positionAt(starts, start), end: positionAt(starts, end) }, message, severity, source: "vascula" };
}

const sameDiag = (a: Diagnostic, b: Diagnostic) =>
  a.message === b.message &&
  a.range.start.line === b.range.start.line &&
  a.range.start.character === b.range.start.character &&
  a.range.end.line === b.range.end.line &&
  a.range.end.character === b.range.end.character;

interface Setting {
  id?: unknown;
  type?: unknown;
  editor?: unknown;
  min?: unknown;
  max?: unknown;
  image?: unknown;
  visible_if?: { setting?: unknown };
}

interface BlocksDecl {
  types?: { type?: unknown; settings?: unknown }[];
  default?: unknown;
  accept_theme_blocks?: unknown;
  accept_app_blocks?: unknown;
  theme_blocks?: unknown;
}

// The platform's metafield block goes wherever theme or app blocks do.
const METAFIELD_BLOCK = "metafield";

/** Whether the section's blocks accept theme:<name> instances. */
function acceptsThemeBlock(b: BlocksDecl | undefined, type: string): boolean {
  if (!b || !type.startsWith("theme:")) return false;
  const name = type.slice("theme:".length);
  if (name === METAFIELD_BLOCK) return b.accept_app_blocks === true || b.accept_theme_blocks === true;
  if (b.accept_theme_blocks !== true) return false;
  const only = Array.isArray(b.theme_blocks) ? b.theme_blocks : [];
  return only.length === 0 || only.includes(name);
}

/** Diagnostics for every schema block in the file. */
export async function validate(uri: string, text: string, options: Options): Promise<Diagnostic[]> {
  const starts = lineStarts(text);
  const blocks = findSchemaBlocks(text);
  const out: Diagnostic[] = [];
  if (blocks.length > 1) {
    for (const b of blocks.slice(1)) {
      out.push(diag(starts, b.tagStart, b.contentStart, "A section has one {% schema %} block.", DiagnosticSeverity.Error));
    }
  }
  for (const b of blocks) {
    if (!b.closed) {
      out.push(diag(starts, b.tagStart, b.contentStart, "{% schema %} has no matching {% endschema %}.", DiagnosticSeverity.Error));
    }
  }
  const block = blocks[0];
  if (!block) return out;

  const doc = docFor(uri, text, block);
  const jsonDoc = strict.parseJSONDocument(doc);
  const errors = (await strict.doValidation(doc, jsonDoc, { schemaValidation: "error", trailingCommas: "error", comments: "error" })).map(
    (d) => ({ ...d, source: "vascula" }),
  );
  out.push(...errors);

  let value: Record<string, unknown> | undefined;
  try {
    value = JSON.parse(text.slice(block.contentStart, block.contentEnd));
  } catch {
    value = undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) value = undefined;
  const raw = text.slice(block.contentStart, block.contentEnd);
  const locate = (needle: string, from = 0) => {
    const i = raw.indexOf(needle, from);
    return i < 0 ? block.contentStart : block.contentStart + i;
  };
  const warnAt = (needle: string, message: string) => {
    const at = locate(needle);
    out.push(diag(starts, at, at + (needle.length || 1), message, DiagnosticSeverity.Warning));
  };
  // Upload-rejected rules that need more than one value of the schema. These are errors, so
  // they are reported with hints off too.
  const errorAt = (needle: string, message: string) => {
    const at = locate(needle);
    out.push(diag(starts, at, at + (needle.length || 1), message, DiagnosticSeverity.Error));
  };
  const imageIds = (settings: unknown) =>
    new Set(Array.isArray(settings) ? (settings as Setting[]).filter((s) => s && s.type === "image" && typeof s.id === "string").map((s) => s.id as string) : []);

  // The checks an upload runs on settings with an editor block.
  // parent: the section's settings, when these belong to a block type.
  const checkEditable = (settings: unknown, where: string, parent?: unknown) => {
    if (!Array.isArray(settings)) return;
    const images = imageIds(settings);
    const parentImages = imageIds(parent);
    for (const s of settings as Setting[]) {
      if (!s || !s.editor || typeof s.id !== "string") continue;
      if (s.type === "range" && typeof s.min === "number" && typeof s.max === "number" && s.max <= s.min) {
        errorAt(`"${s.id}"`, `Range setting "${s.id}": max must be greater than min.`);
      }
      if (s.type === "point" && typeof s.image === "string" && s.image.trim() !== "") {
        if (!images.has(s.image.trim()) && !parentImages.has(s.image.trim())) {
          errorAt(`"${s.image}"`, `Point setting "${s.id}": "${s.image}" is not an image setting ${where}${parent ? " or its section" : ""}.`);
        }
      }
      if (s.visible_if && s.visible_if.setting === s.id) {
        errorAt(`"${s.id}"`, `Setting "${s.id}": visible_if cannot name the setting itself.`);
      }
    }
  };
  const blocksDecl = value?.blocks as BlocksDecl | undefined;
  if (value) {
    checkEditable(value.settings, "in this section");
    if (blocksDecl && typeof blocksDecl === "object" && Array.isArray(blocksDecl.types)) {
      for (const t of blocksDecl.types) if (t && typeof t.type === "string") checkEditable(t.settings, `in block type "${t.type}"`, value.settings);
    }
  }
  if (!options.hints) return out;

  const advDoc = advisory.parseJSONDocument(doc);
  const warnings = await advisory.doValidation(doc, advDoc, { schemaValidation: "warning", trailingCommas: "ignore", comments: "ignore" });
  for (const w of warnings) {
    if (w.severity !== DiagnosticSeverity.Warning) continue;
    if (errors.some((e) => sameDiag(e, w))) continue;
    out.push({ ...w, source: "vascula" });
  }
  if (!value) return out;

  // Rules JSON Schema cannot express.
  const checkSettings = (settings: unknown, where: string) => {
    if (!Array.isArray(settings)) return;
    const ids = new Set<string>();
    for (const s of settings as Setting[]) {
      if (!s || typeof s.id !== "string") continue;
      if (ids.has(s.id)) warnAt(`"${s.id}"`, `Setting id "${s.id}" is used more than once ${where}.`);
      ids.add(s.id);
    }
    for (const s of settings as Setting[]) {
      const target = s?.visible_if?.setting;
      if (typeof target === "string" && !ids.has(target)) {
        warnAt(`"${target}"`, `visible_if names "${target}", which is not a setting ${where}.`);
      }
    }
    return ids;
  };

  const sectionIds = checkSettings(value.settings, "in this section") ?? new Set<string>();
  const typeNames = new Set<string>();
  if (blocksDecl && typeof blocksDecl === "object") {
    for (const t of Array.isArray(blocksDecl.types) ? blocksDecl.types : []) {
      if (!t || typeof t.type !== "string") continue;
      if (typeNames.has(t.type)) warnAt(`"${t.type}"`, `Block type "${t.type}" is declared more than once.`);
      typeNames.add(t.type);
      checkSettings(t.settings, `in block type "${t.type}"`);
    }
    if (Array.isArray(blocksDecl.default)) {
      for (const d of blocksDecl.default) {
        // Only local block types: theme blocks start in presets, not in blocks.default.
        if (typeof d === "string" && !typeNames.has(d)) {
          warnAt(`"${d}"`, `Default block "${d}" is not a declared block type.`);
        }
      }
    }
  }
  const acceptsShared = !!blocksDecl && (blocksDecl.accept_theme_blocks === true || blocksDecl.accept_app_blocks === true);
  if (Array.isArray(value.presets)) {
    for (const p of value.presets as { settings?: unknown; blocks?: unknown }[]) {
      if (p && p.settings && typeof p.settings === "object") {
        for (const k of Object.keys(p.settings)) {
          if (!sectionIds.has(k)) warnAt(`"${k}"`, `Preset setting "${k}" is not a declared setting.`);
        }
      }
      if (p && Array.isArray(p.blocks)) {
        for (const pb of p.blocks as { type?: unknown }[]) {
          const t = pb?.type;
          if (typeof t !== "string") continue;
          const ok = t.startsWith("theme:") ? acceptsThemeBlock(blocksDecl, t) : typeNames.has(t);
          if (!ok) warnAt(`"${t}"`, t.startsWith("theme:") ? `Preset block "${t}" is a theme block the section does not accept.` : `Preset block "${t}" is not a declared block type.`);
        }
      }
    }
  }
  if (!acceptsShared) {
    for (const at of blocksTagOffsets(text)) {
      if (at >= block.tagStart && at < block.tagEnd) continue;
      out.push(
        diag(starts, at, at + 2, "{% blocks %} needs \"accept_theme_blocks\" or \"accept_app_blocks\" in the schema's blocks.", DiagnosticSeverity.Warning),
      );
    }
  }
  if (value.kind === "block" && options.path && typeof value.name === "string") {
    const base = options.path.replace(/\\/g, "/").split("/").pop()?.replace(/\.vasc$/, "");
    if (base && base !== value.name) warnAt('"name"', `A theme block's name matches its file name ("${base}").`);
  }
  return out;
}

export function isInSchema(text: string, offset: number): SchemaBlock | undefined {
  const b = findSchemaBlocks(text)[0];
  return b && offset >= b.contentStart && offset <= b.contentEnd ? b : undefined;
}

export async function complete(uri: string, text: string, block: SchemaBlock, position: Position): Promise<CompletionList | null> {
  const doc = docFor(uri, text, block);
  return strict.doComplete(doc, position, strict.parseJSONDocument(doc));
}

export async function hover(uri: string, text: string, block: SchemaBlock, position: Position): Promise<Hover | null> {
  const doc = docFor(uri, text, block);
  return strict.doHover(doc, position, strict.parseJSONDocument(doc));
}

/** Setting ids declared in the file's schema, for `settings.` completion. */
export function declaredSettings(text: string): { id: string; type: string }[] {
  const b = findSchemaBlocks(text)[0];
  if (!b) return [];
  try {
    const v = JSON.parse(text.slice(b.contentStart, b.contentEnd));
    if (!Array.isArray(v?.settings)) return [];
    return v.settings
      .filter((s: Setting) => typeof s?.id === "string")
      .map((s: Setting) => ({ id: s.id as string, type: typeof s.type === "string" ? s.type : "" }));
  } catch {
    return [];
  }
}

/** ctx_needs declared in the file's schema. */
export function declaredNeeds(text: string): string[] {
  const b = findSchemaBlocks(text)[0];
  if (!b) return [];
  try {
    const v = JSON.parse(text.slice(b.contentStart, b.contentEnd));
    return Array.isArray(v?.ctx_needs) ? v.ctx_needs.filter((n: unknown) => typeof n === "string") : [];
  } catch {
    return [];
  }
}
