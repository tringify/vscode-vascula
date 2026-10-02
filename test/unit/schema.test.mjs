import { test } from "node:test";
import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { core, starterDir, files, read, readJson, root } from "./helpers.mjs";

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

const base = () => ({
  name: "hero",
  ctx_needs: ["shop", "cart.item_count"],
  settings: [{ id: "heading", type: "text", default: "Hi", editor: { label: "Heading", group: "content" } }],
});

async function check(text, path = "sections/hero.vasc") {
  return sectionSchema.validate("file:///" + path, text, { hints: true, path });
}

test("every theme-starter section and block validates with no errors or warnings", async () => {
  const vasc = [...files(join(starterDir, "sections"), ".vasc"), ...files(join(starterDir, "blocks"), ".vasc")];
  assert.ok(vasc.length >= 40, `expected the starter's sections, found ${vasc.length}`);
  for (const f of vasc) {
    const ds = await check(read(f), relative(starterDir, f));
    assert.equal(ds.length, 0, `${relative(starterDir, f)}:\n${fmt(ds)}`);
  }
});

test("starter src/sections/*/schema.json validate against the section schema", async () => {
  const schemas = files(join(starterDir, "src/sections"), "schema.json");
  assert.ok(schemas.length >= 30);
  for (const f of schemas) {
    const ds = await validateJson("section.schema.json", read(f));
    assert.equal(ds.length, 0, `${relative(starterDir, f)}:\n${fmt(ds)}`);
  }
});

test("starter theme.json, templates, settings schema and presets validate", async () => {
  const cases = [
    ["theme.schema.json", [join(starterDir, "theme.json")]],
    ["template.schema.json", files(join(starterDir, "templates"), ".json")],
    ["settings-schema.schema.json", [join(starterDir, "config/settings_schema.json")]],
    ["preset.schema.json", files(join(starterDir, "config/presets"), ".json")],
  ];
  for (const [schema, list] of cases) {
    assert.ok(list.length > 0, schema);
    for (const f of list) {
      const ds = await validateJson(schema, read(f));
      assert.equal(ds.length, 0, `${relative(starterDir, f)}:\n${fmt(ds)}`);
    }
  }
});

test("upload-rejected mistakes are errors", async () => {
  const cases = [
    [(s) => delete s.name, /Missing property "name"/],
    [(s) => (s.settings[0].type = "font_picker"), /Value is not accepted/],
    [(s) => (s.kind = "widget"), /Value is not accepted/],
    [(s) => (s.ctx_needs = ["bogus"]), /Unknown CTX name/],
    [(s) => s.settings.push({ id: "r", type: "range", max: 3 }), /Missing property "min"/],
    [(s) => s.settings.push({ id: "v", type: "text", visible_if: { setting: "heading", values: [] } }), /Array has too few items/],
    [(s) => s.settings.push({ id: "o", type: "object", fields: [{ key: "a", type: "zzz" }] }), /Value is not accepted/],
    [(s) => ((s.kind = "block"), (s.presets = [{ name: "x" }])), /Matches a schema that is not allowed/],
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
