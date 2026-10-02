// Runs inside VS Code (see run.mjs). Plain assertions, one after another.
const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

const workspace = process.env.VASCULA_E2E_WORKSPACE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function open(rel) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, rel)));
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

function write(rel, text) {
  writeFileSync(join(workspace, rel), text);
}

const labels = (list) => list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
const hoverText = (hovers) =>
  hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("a starter section opens as Vascula and is highlighted by the extension's grammar", async () => {
  const { doc } = await open("sections/starter-product.vasc");
  assert.equal(doc.languageId, "vascula");
  const tokens = await until("syntax tokens", async () => {
    const t = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", doc.uri);
    return t && t.length ? t : undefined;
  });
  const scoped = (pred) => tokens.filter((t) => pred(t.t));
  const openers = tokens.filter((t) => t.c.startsWith("{{") || t.c.startsWith("{%"));
  assert.ok(openers.length > 50, `found ${openers.length} markup openers`);
  for (const t of openers) assert.match(t.t, /punctuation\.section\.embedded\.begin\.vascula/, `${t.c} → ${t.t}`);
  assert.ok(scoped((s) => s.includes("support.function.filter.vascula")).some((t) => t.c === "money"), "money is a filter");
  assert.ok(scoped((s) => s.includes("keyword.control.vascula")).length > 10, "control keywords");
  assert.ok(scoped((s) => s.includes("meta.embedded.block.schema.vascula") && s.includes("support.type.property-name.json")).length > 10, "schema JSON");
  assert.ok(scoped((s) => s.includes("source.css")).length > 50, "embedded CSS");
  assert.equal(scoped((s) => /\binvalid\./.test(s)).length, 0, "nothing is invalid");
});

test("every starter section and block has no diagnostics", async () => {
  const files = await vscode.workspace.findFiles("{sections,blocks}/*.vasc");
  assert.ok(files.length >= 40);
  for (const uri of files) {
    await vscode.workspace.openTextDocument(uri);
  }
  await sleep(1500);
  for (const uri of files) {
    const ds = vscode.languages.getDiagnostics(uri);
    assert.equal(ds.length, 0, `${uri.path}: ${ds.map((d) => d.message).join("; ")}`);
  }
});

test("schema mistakes are reported as you type", async () => {
  write(
    "sections/zz-broken.vasc",
    '<p>{{ settings.heading }}</p>\n{% schema %}\n{ "name": "zz-broken", "ctx_needs": ["bogus"], "bogus": 1,\n  "settings": [ { "id": "heading", "type": "font_picker" } ] }\n{% endschema %}\n',
  );
  const { doc } = await open("sections/zz-broken.vasc");
  const ds = await until("diagnostics", async () => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length >= 3 ? d : undefined;
  });
  const errors = ds.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message);
  assert.ok(errors.some((m) => /Unknown CTX name/.test(m)), errors.join("; "));
  assert.ok(errors.some((m) => /Value is not accepted/.test(m)), errors.join("; "));
  assert.ok(ds.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && /bogus is not allowed/.test(d.message)));
  const edit = new vscode.WorkspaceEdit();
  const text = doc.getText();
  const fix = text.replace('["bogus"]', '["shop"]').replace(' "bogus": 1,', "").replace("font_picker", "text");
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), fix);
  await vscode.workspace.applyEdit(edit);
  await until("diagnostics to clear", async () => vscode.languages.getDiagnostics(doc.uri).length === 0);
});

test("filter completions and hovers", async () => {
  write("sections/zz-filters.vasc", "<p>{{ product.price.current | money }}</p>\n<p>{{ product.title |  }}</p>\n");
  const { doc } = await open("sections/zz-filters.vasc");
  const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(1, 23), "|");
  const names = labels(list);
  for (const f of ["money", "image_url", "t", "upcase", "truncate", "default", "json"]) assert.ok(names.includes(f), `${f} offered`);
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", doc.uri, new vscode.Position(0, 32));
  assert.match(hoverText(hovers), /Formats a price/);
});

test("tag, form kind, CTX and settings completions", async () => {
  write(
    "sections/zz-complete.vasc",
    '{% %}\n{% form "" %}{% endform %}\n{{ cart. }}\n{{ settings. }}\n{% schema %}\n{ "name": "zz-complete", "ctx_needs": ["cart", ""],\n  "settings": [ { "id": "heading", "type": "text" } ] }\n{% endschema %}\n',
  );
  const { doc } = await open("sections/zz-complete.vasc");
  const after = (needle, delta = needle.length) => doc.positionAt(doc.getText().indexOf(needle) + delta);
  const at = async (position, trigger) =>
    labels(await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", doc.uri, position, trigger));
  assert.ok((await at(after("{% "))).includes("unless"), "tag names");
  assert.ok((await at(after('{% form "'), '"')).includes("cart_add"), "form kinds");
  assert.ok((await at(after("{{ cart."), ".")).includes("item_count"), "cart fields");
  assert.ok((await at(after("{{ settings."), ".")).includes("heading"), "setting ids");
  const needs = await at(after('["cart", "'), '"');
  assert.ok(needs.includes("product") && needs.includes("cart.item_count"), `ctx_needs: ${needs.slice(0, 8)}`);
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", doc.uri, after("{{ cart", 4));
  assert.match(hoverText(hovers), /CTX root/);
});

test("section sources (src/sections/<name>/body.html) are Vascula and read their schema.json", async () => {
  const { mkdirSync } = require("node:fs");
  mkdirSync(join(workspace, "src/sections/zz-src"), { recursive: true });
  write("src/sections/zz-src/schema.json", '{ "name": "zz-src", "ctx_needs": ["shop"], "settings": [ { "id": "tagline", "type": "text" } ] }\n');
  write("src/sections/zz-src/body.html", "<p>{{ settings. }}</p>\n");
  const { doc } = await open("src/sections/zz-src/body.html");
  assert.equal(doc.languageId, "vascula");
  const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(0, 15), ".");
  assert.ok(labels(list).includes("tagline"), labels(list).join());
  const { doc: schema } = await open("src/sections/zz-src/schema.json");
  write("src/sections/zz-src/schema.json", '{ "name": "zz-src", "settings": [ { "id": "tagline", "type": "headline" } ] }\n');
  await vscode.commands.executeCommand("workbench.action.files.revert");
  await until("schema.json diagnostics", async () => vscode.languages.getDiagnostics(schema.uri).length > 0, 30000);
});

test("comment toggling and auto-closing", async () => {
  write("sections/zz-edit.vasc", "<p>x</p>\n\n\n\n");
  const { doc, editor } = await open("sections/zz-edit.vasc");
  editor.selection = new vscode.Selection(0, 0, 0, 8);
  await vscode.commands.executeCommand("editor.action.blockComment");
  assert.equal(doc.lineAt(0).text, "{# <p>x</p> #}");
  const [major, minor] = vscode.version.split(".").map(Number);
  if (major === 1 && minor < 90) {
    // The `type` command does not run auto-closing in older test hosts.
    console.log(`    (auto-closing not checked on VS Code ${vscode.version})`);
    return;
  }
  editor.selection = new vscode.Selection(1, 0, 1, 0);
  const type = async (text) => {
    for (const ch of text) await vscode.commands.executeCommand("type", { text: ch });
  };
  await type("{{");
  assert.equal(doc.lineAt(1).text, "{{ }}");
  editor.selection = new vscode.Selection(2, 0, 2, 0);
  await type("{%");
  assert.equal(doc.lineAt(2).text, "{% %}");
  editor.selection = new vscode.Selection(3, 0, 3, 0);
  await type("{#");
  assert.equal(doc.lineAt(3).text, "{# #}");
});

test("theme JSON files are validated against the theme schemas", async () => {
  const { doc: home } = await open("templates/home.json");
  write("templates/zz_broken.json", '{ "page_type": "Bad Page", "sections": [ { "type": "x", "position": -1 } ] }\n');
  const { doc } = await open("templates/zz_broken.json");
  const ds = await until("JSON diagnostics", async () => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length >= 2 ? d : undefined;
  }, 60000);
  assert.ok(ds.some((d) => /surface key/.test(d.message)), ds.map((d) => d.message).join("; "));
  assert.ok(ds.some((d) => /minimum of 0/.test(d.message)), ds.map((d) => d.message).join("; "));
  assert.equal(vscode.languages.getDiagnostics(home.uri).length, 0);
  write("config/metafields.json", '[ { "owner_type": "product", "namespace": "specs", "key": "fit", "type": "single_select", "name": "Fit" } ]\n');
  const { doc: meta } = await open("config/metafields.json");
  await until("metafields diagnostics", async () => vscode.languages.getDiagnostics(meta.uri).some((d) => /choices/.test(d.message)), 30000);
});

exports.run = async function run() {
  const ext = vscode.extensions.getExtension("tringify.vscode-vascula");
  assert.ok(ext, "extension is present");
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✔ ${t.name}`);
    } catch (e) {
      failed++;
      console.error(`  ✖ ${t.name}\n${e && e.stack ? e.stack : e}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} end-to-end tests passed (VS Code ${vscode.version}, extension ${ext.packageJSON.version}).`);
  if (failed) throw new Error(`${failed} end-to-end test(s) failed`);
};
