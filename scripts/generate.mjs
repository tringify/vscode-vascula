#!/usr/bin/env node
// Generates the theme-file JSON schemas from the theme author contract.
//
//   node scripts/generate.mjs                     regenerate schemas from data/contract.json
//   node scripts/generate.mjs --contract FILE     import `tringify theme contract` output first
//   node scripts/generate.mjs --check             fail if any generated file is out of date, or if the
//                                                 schemas or data/filters.json disagree with the contract
//
// The contract comes from the Tringify CLI (`tringify theme contract`, https://github.com/tringify/cli).
// It carries the vocabularies (setting types, theme setting types, CTX names and fields, migration
// operations), the JSON fields of the structs a section schema, settings_schema.json and migrations
// are decoded into, the metafield setting owners, the settings schema version, and the filters a
// theme may call. Other rules (manifest and template shapes) follow https://dev-docs.tringify.com/themes/.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const contractArg = args.indexOf("--contract");

const outputs = new Map();
const emit = (path, value) => outputs.set(path, JSON.stringify(value, null, 2) + "\n");

// ---------------------------------------------------------------------------
// Contract import

function trimContract(full, source) {
  if (full.schema_version !== 3 || !full.ctx || full.ctx.schema_version !== 1 || !full.schema_fields || !full.filters) {
    throw new Error("unsupported theme author contract");
  }
  return {
    source,
    schema_version: full.schema_version,
    setting_types: full.setting_types,
    theme_setting_types: full.theme_setting_types,
    migration_operations: full.migration_operations,
    resource_picker_types: full.resource_picker_types,
    max_theme_block_depth: full.max_theme_block_depth,
    default_resource_list_max: full.default_resource_list_max,
    ctx_needs: full.ctx_needs,
    ctx: full.ctx,
    hosted_actions: full.hosted_actions.map((a) => ({
      kind: a.kind,
      group: a.group,
      path: a.path,
      form_capable: a.form_capable,
      multipart: a.multipart,
      fields: a.fields.map((f) => ({ name: f.name, required: f.required, description: f.description })),
    })),
    schema_fields: full.schema_fields,
    metafield_setting_owners: full.metafield_setting_owners,
    settings_schema_version: full.settings_schema_version,
    filters: full.filters,
  };
}

let contract;
if (contractArg >= 0) {
  const file = args[contractArg + 1];
  const sourceArg = args.indexOf("--source");
  const source = sourceArg >= 0 ? args[sourceArg + 1] : "tringify theme contract";
  contract = trimContract(JSON.parse(readFileSync(file, "utf8")), source);
  emit("data/contract.json", contract);
} else {
  contract = JSON.parse(readFileSync(join(root, "data/contract.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// Shared vocabulary

const DOCS = "https://dev-docs.tringify.com";

const settingTypeDocs = {
  text: "Single-line text. The template reads text.",
  textarea: "Multi-line text. The template reads text.",
  richtext: "Rich text editor. The template reads formatted HTML, cleaned of anything unsafe.",
  number: "Number input. The template reads a number.",
  range: "Slider. Needs `min` and `max`; `step` and `unit` are optional. The template reads a number.",
  checkbox: "Toggle. The template reads `true` or `false`.",
  select: "Drop-down. Needs `options`. The template reads the chosen option's `value`.",
  color: "Colour picker. The template reads a hex colour.",
  color_scheme: "One of the theme's colour schemes. The template reads the scheme's id.",
  image: "Image from the media library. The template reads an image URL; use `image_url`.",
  video: "Video from the media library. The template reads a video URL.",
  url: "Link. The template reads a URL.",
  object: "A group of the declared `fields`. The template reads an object of field values.",
  vascula: "Code editor. The template reads the rendered output of the merchant's Vascula code.",
  menu: "Menu picker. The template reads the menu from `settings.<id>_resolved`.",
  product: "Search and pick one product. The template reads the item, or nothing if it was deleted.",
  collection: "Search and pick one collection. The template reads the item, or nothing if it was deleted.",
  category: "Search and pick one category. The template reads the item, or nothing if it was deleted.",
  vendor: "Search and pick one vendor. The template reads the item, or nothing if it was deleted.",
  brand: "Search and pick one brand. The template reads the item, or nothing if it was deleted.",
  page: "Search and pick one page. The template reads the item, or nothing if it was deleted.",
  blog_post: "Search and pick one blog post. The template reads the item, or nothing if it was deleted.",
  blog_category: "Search and pick one blog category. The template reads the item, or nothing if it was deleted.",
  policy: "Search and pick one policy. The template reads the item, or nothing if it was deleted.",
  product_list: "Pick and order several products, up to `max`. The template reads a list of the picked items.",
  collection_list: "Pick and order several collections, up to `max`. The template reads a list of the picked items.",
  datetime: "Date and time in the store's time zone. Stored as wall time without an offset, such as `2026-12-01T09:00`.",
  metafield:
    "Pick one of the store's metafield definitions for the resource named by `owner` (required). The template reads `{namespace, key, handle}`.",
  point:
    "A spot on the image setting named by `image` (required), placed by clicking or dragging. The template reads `x` and `y`, percentages (0–100) of the image's width and height.",
  product_source:
    "A live product feed: a category or collection, optionally narrowed to one tag, with an order and a count up to `max`. The template reads `entity`, `url` and `products`.",
};
const themeSettingTypeDocs = {
  ...settingTypeDocs,
  color_scheme_group: "The theme's colour schemes: a list of schemes with an `id`, `label` and `colors`, described by `fields`.",
  font_picker: "A font from the platform's font library or the store's own fonts. The platform supplies the options.",
  css: "Custom CSS the merchant writes, up to 64 KB.",
};

for (const t of contract.setting_types) {
  if (!settingTypeDocs[t]) throw new Error(`setting type ${t} has no description; add one to scripts/generate.mjs`);
}
for (const t of contract.theme_setting_types) {
  if (!themeSettingTypeDocs[t]) throw new Error(`theme setting type ${t} has no description; add one to scripts/generate.mjs`);
}

const STANDARD_SURFACES = [
  "home", "shop", "product", "collection", "collection_list", "category", "category_list", "page",
  "policy", "blog", "blog_list", "blog_category", "vendor", "vendor_list", "brand", "brand_list",
  "search", "cart", "wishlist", "track_order", "account", "login", "register", "not_found",
  "coming_soon", "maintenance", "password", "unavailable",
];
const GLOBAL_SURFACES = ["global_body_start", "global_body_end", "global_overlay"];
const ALL_SURFACES = [...STANDARD_SURFACES, ...GLOBAL_SURFACES];

const METAFIELD_TYPES = [
  "string", "url", "date", "datetime", "integer", "decimal", "boolean", "json", "list.string", "list.url",
  "single_select", "list.single_select", "file_reference", "list.file_reference", "product_reference",
  "list.product_reference", "variant_reference", "list.variant_reference",
];
const METAFIELD_OWNERS = [
  "product", "variant", "collection", "category", "page", "blog_post", "blog_category", "vendor", "brand", "store",
];

const md = (text, path) => (path ? `${text}\n\n[Documentation](${DOCS}${path})` : text);
const enumOf = (values, docs) => ({
  enum: values,
  markdownEnumDescriptions: values.map((v) => docs(v)),
});

// ---------------------------------------------------------------------------
// CTX names

function resolve(schema) {
  let s = schema;
  for (let i = 0; s && s.ref && i < 8; i++) s = contract.ctx.definitions[s.ref];
  return s || {};
}

const roots = contract.ctx.roots;
{
  const names = roots.map((r) => r.name).sort().join(",");
  if (names !== [...contract.ctx_needs].sort().join(",")) {
    throw new Error("the contract's ctx_needs and CTX roots differ; decide which one ctx_needs completion and hovers follow");
  }
}
const rootDoc = (r) => {
  const where =
    r.availability === "route"
      ? `Provided on ${r.page_types ? r.page_types.map((p) => "`" + p + "`").join(", ") : "its"} pages.`
      : r.availability === "always"
        ? "Available on every page."
        : r.availability === "notice"
          ? "Present after a hosted form submission."
          : r.page_types
            ? `Requested; provided on ${r.page_types.map((p) => "`" + p + "`").join(", ")} pages.`
            : "Requested data, available on normal storefront pages.";
  return `${r.description} ${where}`;
};

const ctxNeedEnum = [];
const ctxNeedDocs = [];
for (const r of roots) {
  ctxNeedEnum.push(r.name);
  ctxNeedDocs.push(rootDoc(r));
}
for (const r of roots) {
  const s = resolve(r.schema);
  if (s.type === "object" && Array.isArray(s.properties)) {
    for (const p of s.properties) {
      ctxNeedEnum.push(`${r.name}.${p.name}`);
      ctxNeedDocs.push(`Only \`${p.name}\` of \`${r.name}\`.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section schema
//
// The field lists, their JSON types and the rules below follow the structs and checks the
// upload uses to read a {% schema %} block. The contract's schema_fields lists those structs,
// and checkSchemaFields() at the end of this file fails when the two disagree.
//
// Strict schema (errors): what an upload rejects. The upload decodes the schema with Go's
// encoding/json, so a field of the wrong JSON type is rejected; unknown keys are ignored,
// except in migrations, which reject them. Setting rules apply only to settings with an
// `editor` block: a setting without one is runtime data the host fills, and is not checked.
// Advisory schema (warnings): documented rules uploads do not enforce, and unknown keys.

const THEME_BLOCK_NAME = "[A-Za-z0-9_-]{1,100}";
// A settings_to_blocks / rename_block destination, or a preset block, naming a theme block.
const SETTING_ID_IN_MIGRATION = "^(?!blocks$)[^.\\[\\]]+$";
const PREVIEW_IMAGE = "^assets/[A-Za-z0-9_.-]*[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.(?:[Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Gg][Ii][Ff])$";

// A rule that fails with its own message: vscode-json-languageservice reports a failed `not`
// with the errorMessage of the schema that holds it.
const fail = (errorMessage) => ({ not: {}, errorMessage });
const forbid = (keys, errorMessage) => ({ not: { anyOf: keys.map((k) => ({ required: [k] })) }, errorMessage });
const closed = (advisory) => (advisory ? { additionalProperties: false } : {});

const OBJECT_FIELD_TYPES = contract.setting_types.filter((t) => t !== "metafield" && t !== "point");
const typeSnippets = (types) => types.map((t) => ({ label: t, markdownDescription: settingTypeDocs[t], body: t }));

function editorDef(advisory) {
  return {
    type: "object",
    markdownDescription:
      "Present on every setting merchants edit. A setting without `editor` is runtime data the host fills, and is not shown to merchants. `label` and `group` can be literal text or keys from `locales/<locale>.schema.json` (`fieldLabel.<label>`, `fieldGroup.<group>`).",
    properties: {
      label: { type: "string", description: "The setting's or block's label in the theme editor." },
      group: { type: "string", description: "The editor group the setting appears in, such as content or settings." },
      icon: { type: "string", description: "For block types: the block's icon in the theme editor." },
    },
    ...(advisory ? { required: ["label"] } : {}),
    ...closed(advisory),
  };
}

function optionDef(advisory) {
  return {
    type: "object",
    properties: {
      value: { type: "string", description: "The value the template reads." },
      label: { type: "string", description: "The label merchants see." },
      group: { type: "string", description: "Set by the platform on font_picker options. Themes do not write it." },
    },
    ...(advisory ? { required: ["value", "label"] } : {}),
    ...closed(advisory),
  };
}

function visibleIfDef(advisory) {
  return {
    type: "object",
    markdownDescription: md(
      "Show the setting in the editor only while another setting of the same section or block has one of `values`, or, with `set`, while it has a value (`true`) or is empty (`false`). Give exactly one of `values` and `set`.",
      "/themes/section-schema#settings",
    ),
    required: ["setting"],
    properties: {
      setting: { type: "string", minLength: 1, pattern: "\\S", description: "The id of the other setting." },
      values: { type: "array", items: { type: "string" }, minItems: 1, description: "The values that show this setting." },
      set: {
        type: "boolean",
        description: "true: show this setting while the other one has a value (an image picked, text entered). false: while it is empty.",
      },
    },
    allOf: [
      { if: { required: ["values", "set"] }, then: fail("visible_if takes exactly one of values and set.") },
      { if: { not: { anyOf: [{ required: ["values"] }, { required: ["set"] }] } }, then: fail("visible_if needs values or set.") },
    ],
    defaultSnippets: [
      { label: "values", body: { setting: "$1", values: ["$2"] } },
      { label: "set", body: { setting: "$1", set: true } },
    ],
    ...closed(advisory),
  };
}

function objectFieldDef(advisory) {
  return {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string", minLength: 1, pattern: "\\S", description: "The field's key in the object value. Unique in the setting." },
      type: {
        type: "string",
        ...enumOf(OBJECT_FIELD_TYPES, (t) => settingTypeDocs[t]),
        markdownDescription: "The field's control. Any setting type except `metafield` and `point`.",
      },
      label: { type: "string", description: "The field's editor label." },
      required: { type: "boolean", description: "The merchant must fill the field." },
      max: { type: "integer", description: "The field's maximum, such as the most characters." },
      options: { type: "array", items: { $ref: "#/definitions/option" }, markdownDescription: "For a `select` field: the choices." },
    },
    defaultSnippets: [{ label: "field", body: { key: "$1", type: "${2:text}", label: "$3" } }],
    ...(advisory ? { required: ["key", "type"] } : {}),
    ...closed(advisory),
  };
}

// The rules an upload applies to a setting with an `editor` block.
function editableSettingRules(types) {
  const when = (type, then) => ({ if: { properties: { type: { const: type } }, required: ["type"] }, then });
  return [
    { required: ["id", "type"], properties: { id: { pattern: "\\S" }, type: { ...enumOf(types, (t) => settingTypeDocs[t]) } } },
    when("range", {
      required: ["min", "max"],
      properties: { step: { exclusiveMinimum: 0, description: "Must be greater than 0." } },
    }),
    when("metafield", { required: ["owner"] }),
    { if: { not: { properties: { type: { const: "metafield" } }, required: ["type"] } }, then: forbid(["owner"], "Only metafield settings take owner.") },
    when("point", { required: ["image"], properties: { image: { pattern: "\\S" } } }),
    { if: { not: { properties: { type: { const: "point" } }, required: ["type"] } }, then: forbid(["image"], "Only point settings take image.") },
    when("object", { required: ["fields"], properties: { fields: { minItems: 1 } } }),
  ];
}

function settingDef(advisory) {
  const s = {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, markdownDescription: "Unique in the section or block. The template reads `settings.<id>`." },
      type: {
        type: "string",
        markdownDescription: md("The setting type, which decides the editor control.", "/themes/section-schema#setting-types"),
        defaultSnippets: typeSnippets(contract.setting_types),
      },
      default: { description: "The value a new section starts with." },
      editor: { $ref: "#/definitions/editor" },
      options: { type: "array", items: { $ref: "#/definitions/option" }, markdownDescription: "For `select`: the choices." },
      fields: {
        type: "array",
        items: { $ref: "#/definitions/objectField" },
        markdownDescription: "For `object`: the fields of the value, each with a unique `key`.",
      },
      min: { type: "number", markdownDescription: "For `range` (required) and `number`: the lowest value." },
      max: {
        type: "number",
        markdownDescription: `For \`range\` (required) and \`number\`: the highest value. For \`product_list\`, \`collection_list\` and \`product_source\`: the most items (${contract.default_resource_list_max} if not set).`,
      },
      step: { type: "number", markdownDescription: "For `range`: the step between values." },
      unit: { type: "string", markdownDescription: "For `range`: the unit shown after the value, such as `px`." },
      visible_if: { $ref: "#/definitions/visibleIf" },
      owner: {
        type: "string",
        ...enumOf(contract.metafield_setting_owners, (o) => `Metafield definitions of ${o === "store" ? "the store" : "a " + o.replace("_", " ")}.`),
        markdownDescription: "For `metafield` (required): the resource whose metafield definitions the merchant picks from. Only `metafield` settings take `owner`.",
      },
      image: {
        type: "string",
        markdownDescription:
          "For `point` (required): the id of the `image` setting the point sits on, in the same block or its section. Only `point` settings take `image`.",
      },
    },
    allOf: [{ if: { required: ["editor"] }, then: { allOf: editableSettingRules(contract.setting_types) } }],
    defaultSnippets: [
      { label: "setting", body: { id: "$1", type: "${2:text}", default: "$3", editor: { label: "$4", group: "${5:content}" } } },
    ],
  };
  if (advisory) {
    s.additionalProperties = false;
    s.required = ["id", "type"];
    s.properties.type = { ...s.properties.type, ...enumOf(contract.setting_types, (t) => settingTypeDocs[t]) };
    s.allOf.push({
      if: { properties: { type: { const: "select" } }, required: ["type"] },
      then: { required: ["options"], properties: { options: { minItems: 1 } } },
    });
  }
  return s;
}

function blockTypeDef(advisory) {
  const d = {
    type: "object",
    required: ["type", "settings"],
    properties: {
      type: { type: "string", minLength: 1, pattern: "\\S", description: "The block type. Unique in the section." },
      editor: { $ref: "#/definitions/editor" },
      settings: {
        type: "array",
        items: { $ref: "#/definitions/setting" },
        allOf: [{ contains: { type: "object", required: ["editor"] }, errorMessage: "A block type needs at least one setting with an editor block." }],
        markdownDescription: "The block's settings. At least one has an `editor` block.",
      },
    },
    defaultSnippets: [
      {
        label: "block type",
        body: { type: "$1", editor: { label: "$2" }, settings: [{ id: "$3", type: "${4:text}", default: "$5", editor: { label: "$6", group: "content" } }] },
      },
    ],
    ...closed(advisory),
  };
  return d;
}

function blocksDef(advisory) {
  return {
    type: "object",
    markdownDescription: md("The blocks the section accepts.", "/themes/section-schema#blocks"),
    properties: {
      types: { type: "array", items: { $ref: "#/definitions/blockType" }, description: "The block types this section defines." },
      default: {
        type: "array",
        items: { type: "string" },
        description: "The blocks a newly added section starts with. Every type must be declared.",
      },
      max: { type: "integer", minimum: 0, description: "The most blocks a merchant can add. Omit for no limit." },
      accept_theme_blocks: {
        type: "boolean",
        markdownDescription: md(
          `Accept the theme's shared theme blocks (\`blocks/<name>.vasc\`), stored as \`theme:<name>\`. Place \`{% blocks %}\` where they render. Blocks nest up to ${contract.max_theme_block_depth} levels.`,
          "/themes/theme-blocks",
        ),
      },
      theme_blocks: {
        type: "array",
        uniqueItems: true,
        items: {
          type: "string",
          pattern: `^${THEME_BLOCK_NAME}$`,
          errorMessage: "A theme block name, as in blocks/<name>.vasc, without theme:.",
        },
        markdownDescription:
          "Accept only these theme blocks (names of `blocks/<name>.vasc`, without `theme:`), such as only slides in a slideshow. Needs `accept_theme_blocks`. Omit to accept every theme block.",
      },
      accept_app_blocks: { type: "boolean", description: "Accept blocks from the merchant's installed apps." },
    },
    allOf: [
      {
        if: { required: ["theme_blocks"], properties: { theme_blocks: { minItems: 1 } } },
        then: { required: ["accept_theme_blocks"], properties: { accept_theme_blocks: { const: true, errorMessage: "theme_blocks needs \"accept_theme_blocks\": true." } } },
      },
    ],
    ...closed(advisory),
  };
}

function presetDef(advisory) {
  return {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, pattern: "\\S", description: "The preset's name in the editor's \"Add section\" list. Unique in the section." },
      category: { type: "string", description: "The category the preset is listed under." },
      settings: { type: "object", description: "Values for declared settings." },
      blocks: { type: "array", items: { $ref: "#/definitions/presetBlock" }, description: "Starting blocks." },
    },
    ...closed(advisory),
  };
}

function presetBlockDef(advisory) {
  return {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string", description: "A declared block type, or theme:<name> for a theme block the section accepts." },
      settings: { type: "object", description: "Values for the block's settings." },
    },
    ...closed(advisory),
  };
}

// Migrations reject unknown keys, so these are closed in the strict schema too.
const opDocs = {
  rename_block: "A local block type was renamed: `from_type` to `to_type` (a declared type, or `theme:<name>` the section accepts).",
  rename_setting: "A setting was renamed in the same scope: `from` to `to`.",
  move_setting: "A setting moved to another scope (section ↔ local block type): `from` to `to`.",
  remove_setting: "A setting was dropped on purpose: `from` only.",
  set_default: "Fill a value for a new setting `to` in saved sections that lack it: `default`.",
  combine_point: "Two retired number settings (`from` horizontal, `from_y` vertical) become the point setting `to`.",
  settings_to_blocks: "Retired settings become theme blocks in `settings.blocks`: `blocks`.",
};
for (const op of contract.migration_operations) {
  if (!opDocs[op]) throw new Error(`migration operation ${op} has no description; add one to scripts/generate.mjs`);
}

function settingLocationDef() {
  return {
    type: "object",
    required: ["setting"],
    properties: {
      block_type: {
        type: "string",
        pattern: "^[^:]*$",
        patternErrorMessage: "A local block type the section declares, without theme: or app:.",
        description: "A local block type. Omit for a section setting.",
      },
      setting: {
        type: "string",
        minLength: 1,
        pattern: SETTING_ID_IN_MIGRATION,
        patternErrorMessage: "A setting id: not blocks, and without dots or brackets.",
        description: "The setting id.",
      },
    },
    additionalProperties: false,
  };
}

function migrationBlockDef() {
  const settingId = { pattern: SETTING_ID_IN_MIGRATION, patternErrorMessage: "A setting id: not blocks, and without dots or brackets." };
  const settingMap = { type: "object", propertyNames: settingId, additionalProperties: { type: "string" } };
  return {
    type: "object",
    required: ["type", "settings"],
    properties: {
      type: {
        type: "string",
        pattern: `^theme:${THEME_BLOCK_NAME}$`,
        patternErrorMessage: "theme:<name>, a theme block the owner accepts.",
        description: "theme:<name>, a theme block the owner accepts.",
      },
      settings: { ...settingMap, minProperties: 1, description: "The new block's setting ids, mapped to the owner's retired setting ids." },
      copy: { ...settingMap, description: "More of the new block's setting ids, mapped to settings the owner keeps." },
      values: { type: "object", propertyNames: settingId, additionalProperties: { not: { type: "null" } }, description: "Fixed settings of the new block." },
      when: { type: "array", items: { type: "string" }, description: "Settings that must all have a value for the block to be created." },
    },
    additionalProperties: false,
  };
}

function migrationDef() {
  const op = (name, then) => ({ if: { properties: { op: { const: name } }, required: ["op"] }, then });
  const none = (name, ...keys) => forbid(keys, `${name} does not take ${keys.join(", ").replace(/, ([^,]*)$/, " or $1")}.`);
  return {
    type: "object",
    required: ["id", "op"],
    markdownDescription: md("An operation that carries merchants' saved settings across a schema change.", "/themes/section-schema#migrations"),
    properties: {
      id: { type: "string", minLength: 1, pattern: "\\S", description: "Unique among the migrations. Never reuse one." },
      op: { type: "string", ...enumOf(contract.migration_operations, (o) => opDocs[o]) },
      from_type: {
        type: "string",
        pattern: "^[^:]+$",
        patternErrorMessage: "The retired local block type, without theme: or app:.",
        description: "rename_block: the retired local block type.",
      },
      to_type: { type: "string", description: "rename_block: a declared block type, or theme:<name>." },
      from: { $ref: "#/definitions/settingLocation" },
      to: { $ref: "#/definitions/settingLocation" },
      from_y: { $ref: "#/definitions/settingLocation" },
      default: { not: { type: "null" }, description: "set_default: the value." },
      blocks: { type: "array", items: { $ref: "#/definitions/migrationBlock" }, description: "settings_to_blocks: the theme blocks to create." },
      source_defaults: {
        type: "object",
        additionalProperties: { not: { type: "null" } },
        description: "settings_to_blocks, or rename_block to a theme block: the retired settings' old defaults.",
      },
    },
    additionalProperties: false,
    allOf: [
      { if: { not: { properties: { op: { const: "rename_block" } }, required: ["op"] } }, then: forbid(["from_type", "to_type"], "from_type and to_type are only for rename_block.") },
      { if: { not: { properties: { op: { const: "settings_to_blocks" } }, required: ["op"] } }, then: forbid(["blocks"], "blocks is only for settings_to_blocks.") },
      {
        if: { not: { properties: { op: { enum: ["settings_to_blocks", "rename_block"] } }, required: ["op"] } },
        then: forbid(["source_defaults"], "source_defaults is only for settings_to_blocks and rename_block."),
      },
      { if: { not: { properties: { op: { const: "combine_point" } }, required: ["op"] } }, then: forbid(["from_y"], "from_y is only for combine_point.") },
      op("rename_block", { required: ["from_type", "to_type"], allOf: [none("rename_block", "from", "to", "default")] }),
      op("settings_to_blocks", { required: ["blocks"], properties: { blocks: { minItems: 1 } }, allOf: [none("settings_to_blocks", "from", "to", "default")] }),
      op("remove_setting", { required: ["from"], allOf: [none("remove_setting", "to", "default")] }),
      op("rename_setting", { required: ["from", "to"], allOf: [none("rename_setting", "default")] }),
      op("move_setting", { required: ["from", "to"], allOf: [none("move_setting", "default")] }),
      op("set_default", { required: ["to", "default"], allOf: [none("set_default", "from")] }),
      op("combine_point", { required: ["from", "from_y", "to"], allOf: [none("combine_point", "default")] }),
    ],
    defaultSnippets: [
      { label: "rename_setting", body: { id: "$1", op: "rename_setting", from: { setting: "$2" }, to: { setting: "$3" } } },
      { label: "remove_setting", body: { id: "$1", op: "remove_setting", from: { setting: "$2" } } },
    ],
  };
}

// CTX names a section may declare: the contract's ctx_needs, optionally with a field path.
const ctxNeedPattern = `^(${contract.ctx_needs.join("|")})(\\.[A-Za-z_][A-Za-z0-9_]*)*$`;

function sectionSchema({ advisory }) {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://github.com/tringify/vscode-vascula/schemas/section${advisory ? ".advisory" : ""}.schema.json`,
    title: "Tringify section schema",
    markdownDescription: md("The `{% schema %}` of a section or theme block.", "/themes/section-schema"),
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, markdownDescription: "The section's name, unique in the theme. A theme block's name matches its file name." },
      kind: {
        type: "string",
        ...enumOf(["section", "layout", "embed", "block"], (k) =>
          ({
            section: "A section merchants place on a page (default).",
            layout: "A section for a global surface such as the header or footer. Declares a `target`.",
            embed: "A section for the overlay layer, such as a cart drawer or popup. Declares a `target`.",
            block: "A theme block in `blocks/`. No `target`, presets or `preview_image`.",
          })[k],
        ),
        markdownDescription: md("`section` (default), `layout`, `embed` or `block`.", "/themes/sections#section-kinds"),
      },
      target: {
        type: "string",
        ...enumOf(GLOBAL_SURFACES, (t) =>
          ({
            global_body_start: "Opening of `<body>`, before the page template: announcement bar, header.",
            global_body_end: "End of `<body>`, after the page template: footer.",
            global_overlay: "Overlay layer: cart drawer, localization prompt, popups.",
          })[t],
        ),
        markdownDescription: md("The global surface a `layout` or `embed` section renders in.", "/themes/templates-and-surfaces#global-surfaces"),
      },
      icon: { type: "string", description: "The icon shown for the section in the editor." },
      preview_image: {
        type: "string",
        pattern: PREVIEW_IMAGE,
        errorMessage: "A theme image asset path such as assets/header-preview.png (.png, .jpg, .jpeg, .webp or .gif).",
        markdownDescription:
          "A theme image (`assets/<name>.png`, `.jpg`, `.jpeg`, `.webp` or `.gif`) the editor shows for this section where merchants choose between interchangeable sections. Not for theme blocks.",
      },
      ctx_needs: {
        type: "array",
        uniqueItems: true,
        markdownDescription: md(
          "The store data the section reads. Declare a root such as `product`, or a dotted need such as `cart.item_count`. A section can read only what it declares.",
          "/ctx/runtime-context",
        ),
        items: {
          type: "string",
          pattern: ctxNeedPattern,
          errorMessage: "Unknown CTX name. A ctx_needs entry is a CTX root, such as product or cart, optionally followed by a field: cart.item_count.",
          defaultSnippets: ctxNeedEnum.map((label, i) => ({ label, markdownDescription: ctxNeedDocs[i], body: label })),
        },
      },
      migrations: {
        type: "array",
        items: { $ref: "#/definitions/migration" },
        markdownDescription: md(
          "Operations, in order, that carry merchants' saved settings and blocks across a change to this schema, such as a renamed setting or block type.",
          "/themes/section-schema#migrations",
        ),
      },
      settings: { type: "array", items: { $ref: "#/definitions/setting" }, markdownDescription: md("The section's settings.", "/themes/section-schema#settings") },
      blocks: { $ref: "#/definitions/blocks" },
      presets: {
        type: "array",
        items: { $ref: "#/definitions/preset" },
        markdownDescription: md("Ready-made versions of the section offered when a merchant adds one.", "/themes/section-schema#presets"),
      },
    },
    allOf: [
      {
        if: { properties: { kind: { const: "block" } }, required: ["kind"] },
        then: {
          allOf: [
            { not: { required: ["target"], properties: { target: { minLength: 1 } } }, errorMessage: "A theme block has no target." },
            { not: { required: ["presets"], properties: { presets: { minItems: 1 } } }, errorMessage: "A theme block has no presets." },
            { not: { required: ["preview_image"], properties: { preview_image: { minLength: 1 } } }, errorMessage: "A theme block has no preview_image." },
          ],
          properties: {
            blocks: {
              required: ["accept_theme_blocks"],
              properties: { accept_theme_blocks: { const: true, errorMessage: "A blocks slot on a theme block needs \"accept_theme_blocks\": true." } },
              allOf: [
                {
                  not: { required: ["types"], properties: { types: { minItems: 1 } } },
                  errorMessage: "A theme block's blocks slot takes only theme blocks: no types of its own.",
                },
              ],
            },
          },
        },
      },
    ],
    definitions: {
      setting: settingDef(advisory),
      objectField: objectFieldDef(advisory),
      option: optionDef(advisory),
      editor: editorDef(advisory),
      visibleIf: visibleIfDef(advisory),
      blocks: blocksDef(advisory),
      blockType: blockTypeDef(advisory),
      preset: presetDef(advisory),
      presetBlock: presetBlockDef(advisory),
      migration: migrationDef(),
      settingLocation: settingLocationDef(),
      migrationBlock: migrationBlockDef(),
    },
  };
  if (advisory) {
    schema.additionalProperties = false;
    schema.allOf.push({
      if: { properties: { kind: { enum: ["layout", "embed"] } }, required: ["kind"] },
      then: { required: ["target"] },
    });
  }
  return schema;
}

const sectionStrict = sectionSchema({ advisory: false });
const sectionAdvisory = sectionSchema({ advisory: true });
emit("schemas/section.schema.json", sectionStrict);
emit("schemas/section.advisory.schema.json", sectionAdvisory);

// ---------------------------------------------------------------------------
// theme.json

// The documented surface keys are offered as completions; the platform's registry
// is the authority, so other lower-case keys are not flagged.
const surfaceSnippets = ALL_SURFACES.map((s) => ({
  label: s,
  markdownDescription: GLOBAL_SURFACES.includes(s) ? `Global surface \`${s}\`.` : `The \`${s}\` page.`,
  body: s,
}));
const surfaceKey = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]*$",
  errorMessage: "A surface key is lower-case letters, digits and underscores, such as product or global_body_start.",
  defaultSnippets: surfaceSnippets,
};
emit("schemas/theme.schema.json", {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/theme.schema.json",
  title: "Tringify theme manifest",
  markdownDescription: md("The theme manifest, `theme.json`.", "/themes/theme-package-structure#themejson"),
  type: "object",
  properties: {
    schema_version: { markdownDescription: "Tringify theme manifests use schema version `3`." },
  },
  if: { required: ["schema_version"], properties: { schema_version: { type: "number" } } },
  then: {
    required: ["schema_version", "name", "source", "status", "sections", "surfaces"],
    properties: {
      schema_version: { const: 3, description: "The manifest schema version." },
      name: { type: "string", minLength: 1, maxLength: 80, description: "The theme's name, up to 80 characters." },
      source: { const: "uploaded", description: "Must be uploaded." },
      status: { enum: ["draft", "published"], description: "draft or published." },
      default_locale: {
        type: "string",
        description: "The theme's default locale, such as en. Required when the package contains locale files.",
      },
      exported_from: { description: "Provenance written by theme exports." },
      sections: {
        type: "array",
        minItems: 1,
        description: "Every section file, listed exactly once.",
        items: {
          type: "object",
          required: ["name", "file"],
          properties: {
            name: { type: "string", minLength: 1, description: "Must match the section schema's name." },
            kind: { enum: ["section", "layout", "embed"], description: "Must match the section schema's kind." },
            file: { type: "string", pattern: "^sections/[^/]+\\.vasc$", description: "sections/<name>.vasc" },
            target: { enum: GLOBAL_SURFACES, description: "Must match the section schema's target." },
            origin: { type: "string", description: "Provenance written by theme exports." },
          },
          defaultSnippets: [{ body: { name: "$1", kind: "section", file: "sections/$1.vasc" } }],
        },
      },
      surfaces: {
        type: "array",
        minItems: 1,
        description: "The editable surfaces and the sections each requires or allows.",
        items: {
          type: "object",
          required: ["surface_key"],
          properties: {
            surface_key: { ...surfaceKey, description: "A registered, theme-editable surface." },
            required_sections: {
              type: "array",
              uniqueItems: true,
              items: { type: "string" },
              description: "Sections that must appear exactly once on this surface.",
            },
            allowed_sections: {
              type: "array",
              uniqueItems: true,
              items: { type: "string" },
              description: "Sections a merchant may add. A section cannot be both required and allowed.",
            },
          },
          defaultSnippets: [{ body: { surface_key: "$1", required_sections: ["$2"], allowed_sections: [] } }],
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// templates/*.json

const blockInstance = {
  type: "object",
  required: ["id", "type"],
  properties: {
    id: { type: "string", minLength: 1, description: "A stable id you choose." },
    type: {
      type: "string",
      markdownDescription: "A declared block type, `theme:<name>` for a theme block, or `app:<app>:<key>` for an app block.",
    },
    settings: { type: "object" },
    disabled: { type: "boolean", description: "Hidden by the merchant." },
  },
};
emit("schemas/template.schema.json", {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/template.schema.json",
  title: "Tringify theme template",
  markdownDescription: md("A surface's starting composition, `templates/<surface>.json`.", "/themes/templates-and-surfaces"),
  type: "object",
  properties: {
    page_type: { markdownDescription: "The surface key. Must match the file name." },
  },
  if: { required: ["page_type"] },
  then: {
    required: ["page_type", "sections"],
    properties: {
      page_type: {
        type: "string",
        pattern: "^[a-z][a-z0-9_]*(__[A-Za-z0-9][A-Za-z0-9_-]*)?$",
        errorMessage: "page_type is a surface key, such as product, or <surface>__<name> for an alternate template. It matches the file name.",
        defaultSnippets: surfaceSnippets,
      },
      name: { type: "string", description: "The alternate template's name in the template picker." },
      sections: {
        type: "array",
        description: "The ordered section instances.",
        items: {
          type: "object",
          required: ["type", "position"],
          properties: {
            type: { type: "string", minLength: 1, description: "The section's name." },
            position: { type: "integer", minimum: 0, description: "Zero or greater, unique in the template." },
            settings: {
              type: "object",
              description: "Values that differ from the schema defaults. A section with blocks carries settings.blocks.",
              properties: { blocks: { type: "array", items: blockInstance } },
            },
            disabled: { type: "boolean" },
          },
          defaultSnippets: [{ body: { type: "$1", position: "^${2:0}", settings: {} } }],
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// config/settings_schema.json, config/presets/*.json, config/metafields.json

// The same SettingDef as section settings, with the theme setting types. Every setting is
// checked here, with or without `editor`, as on upload.
function themeSettingDef() {
  const d = settingDef(false);
  d.required = ["id", "type"];
  d.properties.id = { type: "string", minLength: 1, pattern: "\\S", description: "Unique in the file. Sections and theme tokens read settings.<id>." };
  d.properties.type = {
    type: "string",
    ...enumOf(contract.theme_setting_types, (t) => themeSettingTypeDocs[t]),
    markdownDescription: "The setting type, which decides the editor control.",
  };
  d.properties.default = { description: "The value a new store starts with." };
  d.properties.fields = {
    type: "array",
    items: { $ref: "#/definitions/objectField" },
    markdownDescription: "For `color_scheme_group`: the palette keys every scheme has, each a CSS identifier (`a-z`, `0-9`, `-`, `_`).",
  };
  delete d.defaultSnippets;
  const when = (type, then) => ({ if: { properties: { type: { const: type } }, required: ["type"] }, then });
  d.allOf = [
    when("select", { required: ["options"], properties: { options: { minItems: 1 } } }),
    when("color_scheme_group", {
      required: ["fields"],
      properties: { fields: { minItems: 1, items: { properties: { key: { pattern: "^[a-z0-9_-]+$" } } } } },
    }),
  ];
  return d;
}

function themeMigrationDef() {
  const location = { $ref: "#/definitions/themeSettingLocation" };
  return {
    type: "object",
    required: ["id", "op", "from"],
    markdownDescription: "Carries stores' saved values when a theme setting is renamed (`rename_setting`, `from` and `to`) or dropped on purpose (`remove_setting`, `from`).",
    properties: {
      id: { type: "string", minLength: 1, pattern: "\\S", description: "Unique among the migrations." },
      op: { type: "string", ...enumOf(["rename_setting", "remove_setting"], (o) => opDocs[o]) },
      from: location,
      to: location,
    },
    additionalProperties: false,
    allOf: [
      { if: { properties: { op: { const: "rename_setting" } }, required: ["op"] }, then: { required: ["to"] } },
      { if: { properties: { op: { const: "remove_setting" } }, required: ["op"] }, then: forbid(["to"], "remove_setting takes only from.") },
    ],
  };
}

const settingsSchemaDoc = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/settings-schema.schema.json",
  title: "Tringify global theme settings",
  description: "Global theme settings, config/settings_schema.json.",
  type: ["object", "array"],
  if: { type: "object", required: ["settings"] },
  then: {
    required: ["schema_version"],
    properties: {
      schema_version: {
        type: "integer",
        const: contract.settings_schema_version,
        description: `The settings schema version: ${contract.settings_schema_version}.`,
      },
      settings: { type: "array", items: { $ref: "#/definitions/setting" } },
      migrations: {
        type: "array",
        items: { $ref: "#/definitions/migration" },
        markdownDescription: "Carry stores' saved values across a renamed or removed theme setting.",
      },
    },
  },
  definitions: {
    setting: themeSettingDef(),
    objectField: objectFieldDef(false),
    option: optionDef(false),
    editor: editorDef(false),
    visibleIf: visibleIfDef(false),
    migration: themeMigrationDef(),
    themeSettingLocation: { ...settingLocationDef(), properties: { setting: settingLocationDef().properties.setting } },
  },
};
// Theme settings may use any theme setting type in an object field too.
settingsSchemaDoc.definitions.objectField.properties.type = { type: "string" };
emit("schemas/settings-schema.schema.json", settingsSchemaDoc);

emit("schemas/preset.schema.json", {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/preset.schema.json",
  title: "Tringify theme preset",
  markdownDescription: md(
    "A named set of whole-theme setting values. Every value must pass `config/settings_schema.json`.",
    "/themes/theme-package-structure#optional-capabilities",
  ),
  type: "object",
  required: ["name", "settings"],
  properties: {
    name: { type: "string", minLength: 1, description: "The preset's name." },
    settings: { type: "object", description: "Values for the global settings, by setting id." },
  },
});

const singleSelect = ["single_select", "list.single_select"];
emit("schemas/metafields.schema.json", {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/metafields.schema.json",
  title: "Tringify theme metafield definitions",
  markdownDescription: md("The metafield definitions the theme needs, `config/metafields.json`.", "/themes/metafields"),
  type: "array",
  maxItems: 40,
  items: {
    type: "object",
    required: ["owner_type", "namespace", "key", "type", "name"],
    properties: {
      owner_type: { enum: METAFIELD_OWNERS, description: "What the field belongs to." },
      namespace: { type: "string", minLength: 1, maxLength: 64, description: "Read as <owner>.metafields.<namespace>.<key>." },
      key: { type: "string", minLength: 1, maxLength: 64 },
      type: { enum: METAFIELD_TYPES, markdownDescription: md("The field type.", "/ctx/metafields") },
      name: { type: "string", minLength: 1, maxLength: 100, description: "The name merchants see." },
      description: { type: "string", description: "Optional help text." },
      choices: {
        type: "array",
        minItems: 1,
        description: "For single_select and list.single_select.",
        items: { type: "object", required: ["key", "label"], properties: { key: { type: "string" }, label: { type: "string" } } },
      },
      translatable: { type: "boolean", description: "For text and choice types: merchants can translate the values." },
    },
    allOf: [
      {
        if: { properties: { type: { enum: singleSelect } }, required: ["type"] },
        then: { required: ["choices"] },
      },
    ],
    defaultSnippets: [
      { body: { owner_type: "${1:product}", namespace: "$2", key: "$3", type: "${4:string}", name: "$5" } },
    ],
  },
});

// ---------------------------------------------------------------------------
// Snippets: the setting snippet offers every setting type of the contract

{
  const path = "snippets/vascula.code-snippets";
  const text = readFileSync(join(root, path), "utf8");
  const re = /("Setting": \{[\s\S]*?\\"type\\": \\"\$\{2\|)([^|]+)(\|\})/;
  const m = re.exec(text);
  if (!m) throw new Error(`${path}: the Setting snippet's type choice was not found`);
  const current = m[2].split(",");
  const types = [...current.filter((t) => contract.setting_types.includes(t)), ...contract.setting_types.filter((t) => !current.includes(t))];
  outputs.set(path, text.replace(re, `$1${types.join(",")}$3`));
}

// ---------------------------------------------------------------------------
// Filters: data/filters.json documents exactly the filters a theme may call

{
  const documented = JSON.parse(readFileSync(join(root, "data/filters.json"), "utf8")).filters;
  const builtins = new Set(contract.filters.vascula);
  const storefront = new Set(contract.filters.storefront);
  const problems = [];
  for (const f of documented) {
    if (f.source === "vascula" && !builtins.has(f.name)) problems.push(`${f.name} is not a Vascula built-in filter`);
    // A storefront filter with a built-in's name replaces it in themes.
    if (f.source === "vascula" && storefront.has(f.name)) problems.push(`${f.name} is a storefront filter in themes; document it with source "tringify"`);
    if (f.source === "tringify" && !storefront.has(f.name)) problems.push(`${f.name} is not a storefront filter`);
  }
  const names = new Set(documented.map((f) => f.name));
  for (const n of [...builtins, ...storefront]) {
    if (!names.has(n)) problems.push(`${n} is a filter themes may call, but data/filters.json does not document it`);
  }
  if (problems.length) {
    console.error("data/filters.json disagrees with the contract's filters:\n  " + problems.join("\n  "));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// The schemas against the contract's schema_fields
//
// Each schema object must list exactly the struct's JSON fields, with the JSON type the
// upload decodes them as. A field the platform adds, drops or retypes fails here until
// the schema above describes it.

function checkSchemaFields() {
  const { structs } = contract.schema_fields;
  const problems = [];
  const deref = (doc, s) => (s && s.$ref ? doc.definitions[s.$ref.replace("#/definitions/", "")] : s);
  // A field of JSON type "any" takes any value; the schema may narrow it.
  const typed = (t) => t && t.type !== "any";
  // subset: structs the schema deliberately narrows (theme setting migrations take only
  // rename_setting and remove_setting, without block_type): no field may be missing from
  // the struct, but struct fields may be left out.
  const compare = (where, doc, schema, struct, seen = new Set(), subset = new Set()) => {
    const key = where.split(" ")[0] + ":" + struct;
    if (seen.has(key)) return;
    seen.add(key);
    const fields = structs[struct];
    if (!fields) return problems.push(`${where}: no struct ${struct} in the contract's schema_fields`);
    const props = schema.properties || {};
    const names = fields.map((f) => f.name);
    if (!subset.has(struct)) for (const n of names) if (!(n in props)) problems.push(`${where}: ${struct}.${n} is not in the schema`);
    for (const n of Object.keys(props)) if (!names.includes(n)) problems.push(`${where}: "${n}" is not a field of ${struct}`);
    for (const f of fields) {
      const p = props[f.name];
      if (!p) continue;
      const got = deref(doc, p);
      if (typed(f) && got.type !== f.type) problems.push(`${where}: ${struct}.${f.name} is ${f.go}, so the schema type is ${f.type}, not ${got.type}`);
      if (f.struct) compare(`${where} ${f.name}`, doc, got, f.struct, seen, subset);
      if (f.items) {
        const items = deref(doc, got.items || {});
        if (typed(f.items) && items.type !== f.items.type) problems.push(`${where}: ${struct}.${f.name} items are ${f.items.type}, not ${items.type}`);
        if (f.items.struct) compare(`${where} ${f.name}[]`, doc, items, f.items.struct, seen, subset);
      }
    }
  };
  for (const [name, doc] of [["section.schema.json", sectionStrict], ["section.advisory.schema.json", sectionAdvisory]]) {
    compare(name, doc, doc, contract.schema_fields.section_schema);
  }
  compare("settings-schema.schema.json", settingsSchemaDoc, settingsSchemaDoc.then, contract.schema_fields.settings_schema, new Set(), new Set(["Migration", "SettingLocation"]));
  if (problems.length) {
    console.error("The schemas disagree with the contract's schema_fields:\n  " + [...new Set(problems)].join("\n  "));
    process.exit(1);
  }
}
checkSchemaFields();

// ---------------------------------------------------------------------------
// Write or check

let stale = [];
for (const [path, text] of outputs) {
  const full = join(root, path);
  const current = existsSync(full) ? readFileSync(full, "utf8") : null;
  if (current === text) continue;
  if (check) stale.push(path);
  else writeFileSync(full, text);
}
if (check && stale.length) {
  console.error(`Generated files are out of date: ${stale.join(", ")}. Run npm run generate.`);
  process.exit(1);
}
console.log(check ? "Generated files are up to date." : `Wrote ${outputs.size} files.`);
