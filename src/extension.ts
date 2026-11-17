import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import type * as lsp from "vscode-json-languageservice";
import { markupAt, filterPrefix, tagNamePrefix, formKindPrefix, pathBeforeCursor, isFilterName, isPathHead } from "./regions";
import * as sectionSchema from "./sectionSchema";
import { filters, filter, filterMarkdown, TAGS } from "./filters";
import * as ctx from "./ctx";

const LANGUAGE = "vascula";

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  context.subscriptions.push(diagnostics);

  const timers = new Map<string, NodeJS.Timeout>();
  const versions = new Map<string, number>();

  const refresh = async (doc: vscode.TextDocument) => {
    if (doc.languageId !== LANGUAGE) return;
    const config = vscode.workspace.getConfiguration("vascula", doc.uri);
    if (!config.get<boolean>("validateSectionSchema", true)) {
      diagnostics.delete(doc.uri);
      return;
    }
    const version = doc.version;
    versions.set(doc.uri.toString(), version);
    const found = await sectionSchema.validate(doc.uri.toString(), doc.getText(), {
      hints: config.get<boolean>("schemaHints", true),
      path: doc.uri.path,
    });
    if (versions.get(doc.uri.toString()) !== version) return;
    diagnostics.set(doc.uri, found.map(toDiagnostic));
  };

  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== LANGUAGE) return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void refresh(doc);
      }, 250),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => void refresh(d)),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      diagnostics.delete(d.uri);
      versions.delete(d.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vascula")) vscode.workspace.textDocuments.forEach((d) => void refresh(d));
    }),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
  );
  vscode.workspace.textDocuments.forEach((d) => void refresh(d));

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANGUAGE, { provideCompletionItems }, "|", ".", "'", '"', "%"),
    vscode.languages.registerHoverProvider(LANGUAGE, { provideHover }),
  );
}

export function deactivate(): void {
  // Nothing to release: disposables are owned by the extension context.
}

// ---------------------------------------------------------------------------
// Completion

/**
 * Text that carries the section's schema: the file itself, or for a section source
 * (`src/sections/<name>/body.html`) its sibling `schema.json`.
 */
function schemaSource(doc: vscode.TextDocument, text: string): string {
  if (sectionSchema.declaredSettings(text).length || /\{%-?\s*schema\s*-?%\}/.test(text)) return text;
  if (doc.uri.scheme === "file" && /[\\/]src[\\/]sections[\\/][^\\/]+[\\/]body\.html$/.test(doc.uri.fsPath)) {
    try {
      const json = readFileSync(doc.uri.fsPath.replace(/body\.html$/, "schema.json"), "utf8");
      return `{% schema %}${json}{% endschema %}`;
    } catch {
      return text;
    }
  }
  return text;
}

async function provideCompletionItems(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
  const text = doc.getText();
  const offset = doc.offsetAt(position);

  const block = sectionSchema.isInSchema(text, offset);
  if (block) {
    const list = await sectionSchema.complete(doc.uri.toString(), text, block, position);
    return list ? new vscode.CompletionList(list.items.map(fromLspCompletion), list.isIncomplete) : undefined;
  }

  const m = markupAt(text, offset);
  if (!m) return undefined;

  const kind = formKindPrefix(m);
  if (kind !== undefined) {
    return ctx.hostedActions
      .filter((a) => a.form_capable)
      .map((a) => {
        const item = new vscode.CompletionItem(a.kind, vscode.CompletionItemKind.EnumMember);
        item.detail = `${a.group} · POST ${a.path}`;
        item.documentation = new vscode.MarkdownString(
          a.fields.length
            ? "Fields:\n\n" + a.fields.map((f) => `- \`${f.name}\`${f.required ? " (required)" : ""}: ${f.description}`).join("\n")
            : "No fields.",
        );
        return item;
      });
  }

  const tag = tagNamePrefix(m);
  if (tag !== undefined) {
    const after = text.slice(offset, offset + 200);
    const closed = /^[A-Za-z0-9_]*\s*-?%\}/.test(after);
    return TAGS.map((t, i) => {
      const item = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Keyword);
      item.documentation = new vscode.MarkdownString(t.doc);
      item.sortText = String(i).padStart(3, "0");
      if (t.snippet) item.insertText = new vscode.SnippetString(t.snippet + (closed ? "" : " %}"));
      return item;
    });
  }

  const pipe = filterPrefix(m);
  if (pipe !== undefined) {
    return filters.map((f) => {
      const item = new vscode.CompletionItem(
        { label: f.name, description: f.source === "vascula" ? "Vascula" : "Tringify" },
        vscode.CompletionItemKind.Function,
      );
      item.detail = `| ${f.signature}`;
      item.documentation = new vscode.MarkdownString(filterMarkdown(f));
      item.sortText = (f.source === "tringify" ? "0" : "1") + f.name;
      return item;
    });
  }

  const path = pathBeforeCursor(m);
  if (path) {
    if (path.path.length === 1 && path.path[0] === "settings") {
      const items: vscode.CompletionItem[] = [];
      for (const s of sectionSchema.declaredSettings(schemaSource(doc, text))) {
        const item = new vscode.CompletionItem(s.id, vscode.CompletionItemKind.Property);
        item.detail = s.type ? `${s.type} setting` : "setting";
        items.push(item);
        if (s.type === "menu") {
          const resolved = new vscode.CompletionItem(`${s.id}_resolved`, vscode.CompletionItemKind.Property);
          resolved.detail = "the chosen menu: name, items";
          items.push(resolved);
        }
      }
      const blocks = new vscode.CompletionItem("blocks", vscode.CompletionItemKind.Property);
      blocks.detail = "the section's blocks";
      items.push(blocks);
      return items;
    }
    return ctx.fieldsAt(path.path).map((f) => {
      const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Field);
      item.detail = f.required ? f.type : `${f.type} (optional)`;
      return item;
    });
  }

  // A bare name: the roots this section declares, plus settings.
  if (!m.inString && /(?:^|[\s(,:=<>!|])[A-Za-z_]*$/.test(m.before)) {
    const needs = sectionSchema.declaredNeeds(schemaSource(doc, text));
    const rootsDeclared = [...new Set(needs.map((n) => n.split(".")[0]))];
    const items = rootsDeclared
      .map((name) => ctx.root(name))
      .filter((r): r is ctx.CtxRoot => !!r)
      .map((r) => {
        const item = new vscode.CompletionItem(r.name, vscode.CompletionItemKind.Variable);
        item.detail = "ctx";
        item.documentation = new vscode.MarkdownString(`${r.description} ${ctx.availabilityText(r)}`);
        return item;
      });
    const settings = new vscode.CompletionItem("settings", vscode.CompletionItemKind.Variable);
    settings.detail = "the section's settings";
    items.push(settings);
    return items;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Hover

async function provideHover(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
  const text = doc.getText();
  const offset = doc.offsetAt(position);

  const block = sectionSchema.isInSchema(text, offset);
  if (block) {
    const h = await sectionSchema.hover(doc.uri.toString(), text, block, position);
    return h ? fromLspHover(h) : undefined;
  }

  const range = doc.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) return undefined;
  const m = markupAt(text, doc.offsetAt(range.start));
  if (!m || m.inString) return undefined;
  const word = doc.getText(range);
  const start = doc.offsetAt(range.start);

  if (isFilterName(text, start)) {
    const f = filter(word);
    return f ? new vscode.Hover(new vscode.MarkdownString(filterMarkdown(f)), range) : undefined;
  }
  if (isPathHead(text, start)) {
    const r = ctx.root(word);
    if (r) {
      const declared = sectionSchema.declaredNeeds(schemaSource(doc, text)).some((n) => n === word || n.startsWith(word + "."));
      const md = new vscode.MarkdownString(
        `**${r.name}** · CTX root\n\n${r.description} ${ctx.availabilityText(r)}` +
          (declared ? "" : `\n\nDeclare \`${r.name}\` in the schema's \`ctx_needs\` to read it.`) +
          `\n\n[Documentation](https://dev-docs.tringify.com/ctx/runtime-context)`,
      );
      return new vscode.Hover(md, range);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LSP → VS Code

function toRange(r: lsp.Range): vscode.Range {
  return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
}

function toDiagnostic(d: lsp.Diagnostic): vscode.Diagnostic {
  const severity =
    d.severity === 1
      ? vscode.DiagnosticSeverity.Error
      : d.severity === 2
        ? vscode.DiagnosticSeverity.Warning
        : d.severity === 3
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Hint;
  const out = new vscode.Diagnostic(toRange(d.range), typeof d.message === "string" ? d.message : d.message.value, severity);
  out.source = "vascula";
  return out;
}

function markup(content: string | lsp.MarkupContent | undefined): string | vscode.MarkdownString | undefined {
  if (content === undefined) return undefined;
  if (typeof content === "string") return content;
  return content.kind === "markdown" ? new vscode.MarkdownString(content.value) : content.value;
}

function fromLspCompletion(c: lsp.CompletionItem): vscode.CompletionItem {
  const item = new vscode.CompletionItem(c.label, c.kind ? c.kind - 1 : undefined);
  item.detail = c.detail;
  item.documentation = markup(c.documentation);
  item.sortText = c.sortText;
  item.filterText = c.filterText;
  const snippet = c.insertTextFormat === 2;
  const edit = c.textEdit;
  if (edit && "range" in edit) {
    item.range = toRange(edit.range);
    item.insertText = snippet ? new vscode.SnippetString(edit.newText) : edit.newText;
  } else if (c.insertText !== undefined) {
    item.insertText = snippet ? new vscode.SnippetString(c.insertText) : c.insertText;
  }
  if (c.command) item.command = { title: c.command.title, command: c.command.command, arguments: c.command.arguments };
  return item;
}

function fromLspHover(h: lsp.Hover): vscode.Hover {
  const contents = Array.isArray(h.contents) ? h.contents : [h.contents];
  const parts = contents.map((c) =>
    typeof c === "string"
      ? new vscode.MarkdownString(c)
      : "kind" in c
        ? new vscode.MarkdownString(c.value)
        : new vscode.MarkdownString().appendCodeblock(c.value, c.language),
  );
  return new vscode.Hover(parts, h.range ? toRange(h.range) : undefined);
}
