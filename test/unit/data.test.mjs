import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { core, readJson, read, root } from "./helpers.mjs";

const { regions, ctx, filters } = core;
const contract = readJson(join(root, "data/contract.json"));

test("filters: all Vascula built-ins and Tringify platform filters, each documented", () => {
  const builtins = filters.filters.filter((f) => f.source === "vascula").map((f) => f.name);
  const platform = filters.filters.filter((f) => f.source === "tringify").map((f) => f.name);
  // https://vascula.dev/filters lists these, and they match vascula's filters.go.
  assert.equal(builtins.length, 50);
  assert.deepEqual(platform.sort(), ["asset_url", "image_loading", "image_srcset", "image_url", "money", "placeholder_svg", "placeholder_video", "t"]);
  assert.equal(new Set(builtins.concat(platform)).size, builtins.length + platform.length);
  for (const f of filters.filters) assert.ok(f.doc && f.example && f.signature.startsWith(f.name), f.name);
  assert.match(filters.filterMarkdown(filters.filter("money")), /platform-filters#money/);
  assert.match(filters.filterMarkdown(filters.filter("sort_natural")), /vascula\.dev\/filters#sort-natural/);
});

test("ctx: roots and fields come from the theme author contract", () => {
  assert.deepEqual(ctx.roots.map((r) => r.name), contract.ctx_needs);
  assert.ok(ctx.fieldsAt(["cart"]).some((f) => f.name === "item_count"));
  const price = ctx.fieldsAt(["product", "price"]).map((f) => f.name);
  assert.ok(price.includes("current"), price.join());
  assert.ok(ctx.fieldsAt(["products", "items"]).some((f) => f.name === "first"));
  assert.ok(ctx.fieldsAt(["products", "items", "[]"]).some((f) => f.name === "title"));
  assert.deepEqual(ctx.fieldsAt(["nope"]), []);
});

test("snippets and section schema offer exactly the contract's setting types", () => {
  const snippets = readJson(join(root, "snippets/vascula.code-snippets"));
  const choice = /\$\{2\|([^|]+)\|\}/.exec(snippets.Setting.body)[1].split(",");
  assert.deepEqual([...choice].sort(), [...contract.setting_types].sort());
  const schema = readJson(join(root, "schemas/section.schema.json"));
  assert.deepEqual(schema.definitions.setting.properties.type.enum, contract.setting_types);
  const forms = /form '\$\{1\|([^|]+)\|\}'/.exec(snippets.form.body[0])[1].split(",");
  const kinds = new Set(contract.hosted_actions.filter((a) => a.form_capable).map((a) => a.kind));
  for (const k of forms) assert.ok(kinds.has(k), k);
});

test("regions: markup, filters, paths and schema blocks", () => {
  const text = '<p>{{ product.price | mo }}</p>{% if x %}{% for p in cart.items %}{{ p.title }}{% endfor %}{% form "cart_';
  const m1 = regions.markupAt(text, text.indexOf(" mo") + 3);
  assert.equal(m1.kind, "output");
  assert.equal(regions.filterPrefix(m1), "mo");
  const m2 = regions.markupAt(text, text.length);
  assert.equal(regions.formKindPrefix(m2), "cart_");
  assert.equal(regions.markupAt(text, text.indexOf("</p>") + 1), undefined, "between markup is text");
  const p = regions.markupAt("{{ product.price.", 17);
  assert.deepEqual(regions.pathBeforeCursor(p), { path: ["product", "price"], partial: "" });
  const q = regions.markupAt("{{ product.images[0].al", 23);
  assert.deepEqual(regions.pathBeforeCursor(q), { path: ["product", "images", "[]"], partial: "al" });
  assert.equal(regions.tagNamePrefix(regions.markupAt("{%- unl", 7)), "unl");
  assert.equal(regions.markupAt('{{ "}}" | ', 10).kind, "output", "a closer inside a string does not end the markup");
  assert.equal(regions.markupAt("{# {{ x #}", 7), undefined, "comments are not markup");

  const sec = '<p></p>\n{%- schema -%}\n{"name":"a"}\n{%- endschema -%}\n';
  const [b] = regions.findSchemaBlocks(sec);
  assert.equal(sec.slice(b.contentStart, b.contentEnd).trim(), '{"name":"a"}');
  const v = regions.virtualJson(sec, b);
  assert.equal(v.length, sec.length);
  assert.equal(v.trim(), '{"name":"a"}');
  assert.equal(regions.markupAt(sec, sec.indexOf("name")), undefined, "the schema is not markup");
});

test("grammar declares every keyword the docs list", () => {
  const grammar = read(join(root, "syntaxes/vascula.tmLanguage.json"));
  for (const k of ["if", "elsif", "else", "endif", "unless", "case", "when", "for", "break", "continue", "cycle", "assign", "capture", "render", "form", "comment", "blocks", "schema"]) {
    assert.ok(new RegExp(`[(|]${k}[|)]`).test(grammar), k);
  }
});
