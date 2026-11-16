import { test } from "node:test";
import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { core, canvasDir, files, read, readJson, root } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { getLanguageService, TextDocument } = require("vscode-json-languageservice");
const { sectionSchema } = core;

const fmt = (ds) => ds.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`).join("\n");

function validateJson(schemaFile, text, uri = "file:///x.json") {
  const ls = getLanguageService({});
  ls.configure({ validate: true, schemas: [{ uri: "vascula:" + schemaFile, fileMatch: ["*"], schema: readJson(join(root, "schemas", schemaFile)) }] });
  const doc = TextDocument.create(uri, "json", 1, text);
  return ls.doValidation(doc, ls.parseJSONDocument(doc), { schemaValidation: "error" });
}

const section = (schema, markup = "<p>{{ settings.heading }}</p>") =>
  `${markup}\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}\n`;

const ed = { label: "Label" };
const base = () => ({
  name: "hero",
  ctx_needs: ["shop", "cart.item_count"],
  settings: [{ id: "heading", type: "text", default: "Hi", editor: { label: "Heading", group: "content" } }],
});

async function check(text, path = "sections/hero.vasc") {
  return sectionSchema.validate("file:///" + path, text, { hints: true, path });
}

test("every Canvas section and block validates with no errors or warnings", async () => {
  const vasc = [...files(join(canvasDir, "sections"), ".vasc"), ...files(join(canvasDir, "blocks"), ".vasc")];
  assert.ok(vasc.length >= 40, `expected Canvas's sections, found ${vasc.length}`);
  for (const f of vasc) {
    const ds = await check(read(f), relative(canvasDir, f));
    assert.equal(ds.length, 0, `${relative(canvasDir, f)}:\n${fmt(ds)}`);
  }
});

test("Canvas src/sections/*/schema.json validate against the section schema", async () => {
  const schemas = files(join(canvasDir, "src/sections"), "schema.json");
  assert.ok(schemas.length >= 30);
  for (const f of schemas) {
    const ds = await validateJson("section.schema.json", read(f));
    assert.equal(ds.length, 0, `${relative(canvasDir, f)}:\n${fmt(ds)}`);
  }
});

test("Canvas theme.json, templates, settings schema and presets validate", async () => {
  const cases = [
    ["theme.schema.json", [join(canvasDir, "theme.json")]],
    ["template.schema.json", files(join(canvasDir, "templates"), ".json")],
    ["settings-schema.schema.json", [join(canvasDir, "config/settings_schema.json")]],
    ["preset.schema.json", files(join(canvasDir, "config/presets"), ".json")],
  ];
  for (const [schema, list] of cases) {
    assert.ok(list.length > 0, schema);
    for (const f of list) {
      const ds = await validateJson(schema, read(f));
      assert.equal(ds.length, 0, `${relative(canvasDir, f)}:\n${fmt(ds)}`);
    }
  }
});

test("upload-rejected mistakes are errors", async () => {
  const cases = [
    [(s) => delete s.name, /Missing property "name"/],
    [(s) => (s.settings[0].type = "font_picker"), /Value is not accepted/],
    [(s) => (s.kind = "widget"), /Value is not accepted/],
    [(s) => (s.ctx_needs = ["bogus"]), /Unknown CTX name/],
    [(s) => s.settings.push({ id: "r", type: "range", max: 3, editor: ed }), /Missing property "min"/],
    [(s) => s.settings.push({ id: "v", type: "text", editor: ed, visible_if: { setting: "heading", values: [] } }), /Array has too few items/],
    [(s) => s.settings.push({ id: "o", type: "object", editor: ed, fields: [{ key: "a", type: "zzz" }] }), /Value is not accepted/],
    [(s) => ((s.kind = "block"), (s.presets = [{ name: "x" }])), /A theme block has no presets/],
    // Platform rules added with the theme tools v0.1.75 contract (vascula/section.go, migrations.go).
    [(s) => (s.ctx_needs = ["review_notice"]), /Unknown CTX name/], // no longer a CTX root
    [(s) => (s.settings[0].type = "css"), /Value is not accepted/], // a theme setting type, not a section one
    [(s) => s.settings.push({ id: "v", type: "text", editor: ed, visible_if: { setting: "heading", values: ["a"], set: true } }), /visible_if takes exactly one of values and set/],
    [(s) => s.settings.push({ id: "v", type: "text", editor: ed, visible_if: { setting: "heading" } }), /visible_if needs values or set/],
    [(s) => s.settings.push({ id: "v", type: "text", editor: ed, visible_if: { setting: "heading", values: [true] } }), /Incorrect type/],
    [(s) => s.settings.push({ id: "v", type: "text", editor: ed, visible_if: { setting: "v", set: true } }), /cannot name the setting itself/],
    [(s) => s.settings.push({ id: "p", type: "point", editor: ed }), /Missing property "image"/],
    [(s) => s.settings.push({ id: "p", type: "point", editor: ed, image: "heading" }), /not an image setting/],
    [(s) => s.settings.push({ id: "t", type: "text", editor: ed, image: "photo" }), /Only point settings take image/],
    [(s) => s.settings.push({ id: "m", type: "metafield", editor: ed }), /Missing property "owner"/],
    [(s) => s.settings.push({ id: "m", type: "metafield", editor: ed, owner: "order" }), /Value is not accepted/],
    [(s) => s.settings.push({ id: "t", type: "text", editor: ed, owner: "product" }), /Only metafield settings take owner/],
    [(s) => s.settings.push({ id: "r", type: "range", editor: ed, min: 0, max: 10, step: 0 }), /below the exclusive minimum of 0/],
    [(s) => s.settings.push({ id: "r", type: "range", editor: ed, min: 5, max: 5 }), /max must be greater than min/],
    [(s) => s.settings.push({ id: "n", type: "number", editor: ed, min: "1" }), /Incorrect type/],
    [(s) => (s.blocks = { theme_blocks: ["slide"] }), /Missing property "accept_theme_blocks"/],
    [(s) => (s.blocks = { accept_theme_blocks: false, theme_blocks: ["slide"] }), /theme_blocks needs "accept_theme_blocks": true/],
    [(s) => (s.blocks = { accept_theme_blocks: true, theme_blocks: ["theme:slide"] }), /theme block name/],
    [(s) => (s.blocks = { types: [{ type: "row", settings: [{ id: "x", type: "text" }] }] }), /at least one setting with an editor block/],
    [(s) => (s.preview_image = "header.png"), /theme image asset path/],
    [(s) => ((s.kind = "block"), (s.preview_image = "assets/a.png")), /A theme block has no preview_image/],
    [(s) => ((s.kind = "block"), (s.blocks = { accept_theme_blocks: true, types: [{ type: "row", settings: [{ id: "x", type: "text", editor: ed }] }] })), /takes only theme blocks: no types of its own/],
    [(s) => (s.migrations = [{ id: "m1", op: "rename" }]), /Value is not accepted/],
    [(s) => (s.migrations = [{ id: "m1", op: "rename_setting", from: { setting: "title" } }]), /Missing property "to"/],
    [(s) => (s.migrations = [{ id: "m1", op: "remove_setting", form: { setting: "title" } }]), /Property form is not allowed/],
    [(s) => (s.migrations = [{ id: "m1", op: "remove_setting", from: { setting: "a.b" } }]), /without dots or brackets/],
    [(s) => (s.migrations = [{ id: "m1", op: "rename_setting", from: { setting: "a" }, to: { setting: "heading" }, blocks: [] }]), /blocks is only for settings_to_blocks/],
    [(s) => (s.migrations = [{ id: "m1", op: "settings_to_blocks", blocks: [{ type: "slide", settings: { a: "b" } }] }]), /theme:<name>, a theme block the owner accepts/],
  ];
  for (const [mutate, expected] of cases) {
    const s = base();
    mutate(s);
    const ds = await check(section(s));
    const errors = ds.filter((d) => d.severity === 1);
    assert.ok(errors.some((d) => expected.test(d.message)), `${expected} not in:\n${fmt(ds)}`);
  }
});

test("valid dotted ctx_needs are accepted", async () => {
  const s = base();
  s.ctx_needs = ["cart.items", "cart.item_count", "wishlist.items", "customer.addresses", "product"];
  const ds = await check(section(s));
  assert.equal(ds.length, 0, fmt(ds));
});

test("documented rules uploads do not enforce are warnings", async () => {
  const cases = [
    [(s) => (s.bogus = 1), /Property bogus is not allowed/],
    [(s) => (s.settings[0].defualt = "x"), /Property defualt is not allowed/],
    [(s) => s.settings.push({ ...s.settings[0] }), /used more than once/],
    [(s) => s.settings.push({ id: "c", type: "select" }), /Missing property "options"/],
    [(s) => s.settings.push({ id: "v", type: "text", visible_if: { setting: "nope", values: ["a"] } }), /not a setting/],
    [(s) => (s.presets = [{ name: "P", settings: { nope: 1 } }]), /not a declared setting/],
    [(s) => (s.blocks = { default: ["slide"], types: [] }), /not a declared block type/],
    [(s) => (s.kind = "layout"), /Missing property "target"/],
  ];
  for (const [mutate, expected] of cases) {
    const s = base();
    mutate(s);
    const ds = await check(section(s));
    assert.ok(ds.every((d) => d.severity !== 1), `unexpected error:\n${fmt(ds)}`);
    assert.ok(ds.some((d) => d.severity === 2 && expected.test(d.message)), `${expected} not in:\n${fmt(ds)}`);
  }
  const quiet = await sectionSchema.validate("file:///a.vasc", section({ ...base(), bogus: 1 }), { hints: false });
  assert.equal(quiet.length, 0, "hints off silences warnings");
});

test("{% blocks %} without accept_theme_blocks warns; JSON and structure errors are reported", async () => {
  let ds = await check(section(base(), "<div>{% blocks %}</div>"));
  assert.ok(ds.some((d) => /needs "accept_theme_blocks"/.test(d.message)), fmt(ds));
  ds = await check(section({ ...base(), blocks: { accept_theme_blocks: true } }, "<div>{% blocks %}</div>"));
  assert.equal(ds.length, 0, fmt(ds));
  ds = await check('{% schema %}\n{ "name": "x", }\n{% endschema %}');
  assert.ok(ds.some((d) => d.severity === 1 && /Trailing comma/.test(d.message)), fmt(ds));
  ds = await check('{% schema %}\n{ "name": "x" }\n');
  assert.ok(ds.some((d) => /no matching/.test(d.message)), fmt(ds));
  ds = await check(section(base()) + section(base()));
  assert.ok(ds.some((d) => /one \{% schema %\}/.test(d.message)), fmt(ds));
  ds = await check(section({ name: "other", kind: "block", settings: [] }), "blocks/button.vasc");
  assert.ok(ds.some((d) => /matches its file name/.test(d.message)), fmt(ds));
  ds = await check(`{% comment %}{% schema %}{"nope": }{% endschema %}{% endcomment %}<p></p>`);
  assert.equal(ds.length, 0, "a schema inside a comment is ignored");
});

test("theme-file schemas catch common mistakes but leave unrelated JSON alone", async () => {
  const t = (schema, value) => validateJson(schema, JSON.stringify(value));
  const none = async (schema, value) => {
    const ds = await t(schema, value);
    assert.equal(ds.length, 0, `${schema}:\n${fmt(ds)}`);
  };
  assert.ok((await t("theme.schema.json", { schema_version: 3, name: "x", source: "uploaded", status: "live", sections: [{ name: "a", file: "a.vasc" }], surfaces: [{ surface_key: "Home Page" }] })).length >= 3);
  assert.ok((await t("template.schema.json", { page_type: "home", sections: [{ type: "a", position: -1 }] })).length >= 1);
  await none("template.schema.json", { page_type: "product__preorder", name: "Pre-order", sections: [] });
  assert.ok((await t("template.schema.json", { page_type: "Product Page", sections: [] })).length >= 1);
  assert.ok((await t("metafields.schema.json", [{ owner_type: "product", namespace: "a", key: "b", type: "single_select", name: "Fit" }])).length >= 1);
  await none("metafields.schema.json", [{ owner_type: "product", namespace: "specs", key: "material", type: "string", name: "Material", translatable: true }]);
  // Other ecosystems use the same file names; those files must not light up.
  await none("theme.schema.json", { version: 3, settings: { color: {} }, styles: {} });
  await none("template.schema.json", { sections: { main: { type: "main-product" } }, order: ["main"] });
  await none("settings-schema.schema.json", [{ name: "theme_info", theme_name: "Dawn" }]);
});

test("completion and hover inside the schema block", async () => {
  const text = section(base()).replace('"cart.item_count"', '"cart.item_count", ""');
  const offset = text.indexOf('""') + 1;
  const block = core.regions.findSchemaBlocks(text)[0];
  const before = text.slice(0, offset);
  const position = { line: before.split("\n").length - 1, character: offset - before.lastIndexOf("\n") - 1 };
  const list = await sectionSchema.complete("file:///a.vasc", text, block, position);
  const labels = list.items.map((i) => i.label);
  for (const n of ["product", "cart", "localization", "cart.items"]) assert.ok(labels.some((l) => l.includes(n)), `${n} in ${labels.slice(0, 10)}`);
  const typeOffset = text.indexOf('"text"') + 2;
  const tb = text.slice(0, typeOffset);
  const hover = await sectionSchema.hover("file:///a.vasc", text, block, { line: tb.split("\n").length - 1, character: typeOffset - tb.lastIndexOf("\n") - 1 });
  assert.match(JSON.stringify(hover.contents), /Single-line text/);
});

test("the whole Canvas tree: every file the extension validates has no diagnostics", async () => {
  // The files VS Code validates: package.json's jsonValidation patterns, and every .vasc file.
  const pkg = readJson(join(root, "package.json"));
  const all = files(canvasDir, "").filter((f) => !relative(canvasDir, f).split("/").includes(".git"));
  const toRegex = (glob) => new RegExp("(^|/)" + glob.replace(/[.]/g, "\\.").replace(/\*\*\//g, "(.*/)?").replace(/\*/g, "[^/]*") + "$");
  let count = 0;
  for (const { fileMatch, url } of pkg.contributes.jsonValidation) {
    const schema = url.replace("./schemas/", "");
    const matching = all.filter((f) => fileMatch.some((g) => toRegex(g).test(relative(canvasDir, f))));
    for (const f of matching) {
      const ds = await validateJson(schema, read(f));
      assert.equal(ds.length, 0, `${relative(canvasDir, f)} (${schema}):\n${fmt(ds)}`);
      count++;
    }
  }
  for (const f of all.filter((p) => p.endsWith(".vasc"))) {
    const ds = await check(read(f), relative(canvasDir, f));
    assert.equal(ds.length, 0, `${relative(canvasDir, f)}:\n${fmt(ds)}`);
    count++;
  }
  assert.ok(count >= 150, `validated ${count} files`);
});

test("the platform's newer schema features are accepted when used correctly", async () => {
  const s = base();
  s.ctx_needs = ["shop", "age_gate", "express", "theme_preview", "design_mode", "picked_for_you.items"];
  s.preview_image = "assets/hero-preview.webp";
  s.settings.push(
    { id: "photo", type: "image", editor: ed },
    { id: "alt", type: "text", editor: ed, visible_if: { setting: "photo", set: true } },
    { id: "focus", type: "point", editor: ed, image: "photo", default: { x: 50, y: 50 } },
    { id: "spec", type: "metafield", owner: "product", editor: ed, default: "specs.material" },
    { id: "starts", type: "datetime", editor: ed },
    { id: "shelf", type: "product_source", max: 8, editor: ed },
    { id: "speed", type: "range", min: 1, max: 10, step: 0.5, editor: ed },
    { id: "locale", type: "anything-the-host-fills" },
  );
  s.blocks = {
    accept_theme_blocks: true,
    theme_blocks: ["slide", "metafield"],
    types: [{ type: "pin", settings: [{ id: "at", type: "point", image: "photo", editor: ed }] }],
  };
  s.presets = [{ name: "Default", blocks: [{ type: "theme:slide" }, { type: "pin" }] }];
  s.migrations = [
    { id: "m1", op: "rename_setting", from: { setting: "title" }, to: { setting: "heading" } },
    { id: "m2", op: "move_setting", from: { setting: "old_alt" }, to: { block_type: "pin", setting: "at" } },
    { id: "m3", op: "remove_setting", from: { setting: "legacy" } },
    { id: "m4", op: "set_default", to: { setting: "speed" }, default: 3 },
    { id: "m5", op: "combine_point", from: { setting: "fx" }, from_y: { setting: "fy" }, to: { setting: "focus" } },
    { id: "m6", op: "rename_block", from_type: "card", to_type: "theme:slide", source_defaults: { title: "Hi" } },
    { id: "m7", op: "settings_to_blocks", blocks: [{ type: "theme:slide", settings: { heading: "slide_title" }, when: ["slide_title"] }], source_defaults: { slide_title: "" } },
  ];
  const ds = await check(section(s, "<div>{% blocks %}</div>"));
  // The host-filled setting has no editor, so only the advisory unknown-type warning remains.
  assert.deepEqual(ds.map((d) => [d.severity, d.message.slice(0, 24)]), [[2, "Value is not accepted. V"]], fmt(ds));

  const block = { name: "slide", kind: "block", settings: [{ id: "t", type: "text", editor: ed }], blocks: { accept_theme_blocks: true, theme_blocks: ["button"] } };
  assert.equal((await check(section(block), "blocks/slide.vasc")).length, 0);
});

test("upload-rejected rules that need several values are errors with hints off too", async () => {
  const s = base();
  s.settings.push({ id: "r", type: "range", editor: ed, min: 5, max: 1 }, { id: "p", type: "point", editor: ed, image: "nope" });
  s.blocks = { types: [{ type: "row", settings: [{ id: "q", type: "point", editor: ed, image: "heading" }] }] };
  const ds = await sectionSchema.validate("file:///a.vasc", section(s), { hints: false });
  const msgs = ds.filter((d) => d.severity === 1).map((d) => d.message);
  assert.ok(msgs.some((m) => /max must be greater than min/.test(m)), msgs.join("\n"));
  assert.ok(msgs.some((m) => /"nope" is not an image setting in this section/.test(m)), msgs.join("\n"));
  assert.ok(msgs.some((m) => /"heading" is not an image setting in block type "row" or its section/.test(m)), msgs.join("\n"));
  const warn = await check(section({ ...base(), blocks: { accept_theme_blocks: true, theme_blocks: ["slide"] }, presets: [{ name: "P", blocks: [{ type: "theme:card" }] }] }));
  assert.ok(warn.some((d) => /theme block the section does not accept/.test(d.message)), fmt(warn));
});

test("config/settings_schema.json: the theme setting types and migrations", async () => {
  const doc = (settings, extra = {}) => JSON.stringify({ schema_version: 1, settings, ...extra });
  const ok = [
    { id: "scheme", type: "color_scheme_group", fields: [{ key: "bg", label: "Background" }, { key: "btn-text" }] },
    { id: "css", type: "css" },
    { id: "font", type: "font_picker", default: "inter" },
    { id: "radius", type: "range", default: 4 }, // theme ranges need no min/max
  ];
  let ds = await validateJson("settings-schema.schema.json", doc(ok, { migrations: [{ id: "m1", op: "rename_setting", from: { setting: "a" }, to: { setting: "css" } }, { id: "m2", op: "remove_setting", from: { setting: "b" } }] }));
  assert.equal(ds.length, 0, fmt(ds));
  const bad = [
    [doc([{ id: "logo", type: "image" }]), /Value is not accepted/], // a section type, not a theme one
    [doc([{ id: "s", type: "select" }]), /Missing property "options"/],
    [doc([{ id: "g", type: "color_scheme_group", fields: [{ key: "Bg Colour" }] }]), /does not match the pattern/],
    [doc([{ id: "g", type: "color_scheme_group" }]), /Missing property "fields"/],
    [JSON.stringify({ schema_version: 2, settings: [] }), /Value must be 1/],
    [doc([], { migrations: [{ id: "m", op: "move_setting", from: { setting: "a" }, to: { setting: "b" } }] }), /Value is not accepted/],
    [doc([], { migrations: [{ id: "m", op: "rename_setting", from: { block_type: "x", setting: "a" }, to: { setting: "b" } }] }), /Property block_type is not allowed/],
    [doc([], { migrations: [{ id: "m", op: "remove_setting", from: { setting: "a" }, to: { setting: "b" } }] }), /remove_setting takes only from/],
  ];
  for (const [text, expected] of bad) {
    ds = await validateJson("settings-schema.schema.json", text);
    assert.ok(ds.some((d) => expected.test(d.message)), `${expected} not in:\n${fmt(ds)}\nfor ${text}`);
  }
});
