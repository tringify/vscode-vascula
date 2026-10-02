#!/usr/bin/env node
// Generates the theme-file JSON schemas from the theme author contract.
//
//   node scripts/generate.mjs                     regenerate schemas from data/contract.json
//   node scripts/generate.mjs --contract FILE     import `tringify theme contract` output first
//   node scripts/generate.mjs --check             fail if any generated file is out of date
//
// The contract comes from the Tringify CLI (`tringify theme contract`, https://github.com/tringify/cli),
// or the theme tools' `tringify-theme contract` (https://github.com/tringify/theme-tools).
// Rules the contract does not carry (field lists, manifest and template shapes) follow
// https://dev-docs.tringify.com/themes/ and are written out below.

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
  if (full.schema_version !== 3 || !full.ctx || full.ctx.schema_version !== 1) {
    throw new Error("unsupported theme author contract");
  }
  return {
    source,
    schema_version: full.schema_version,
    setting_types: full.setting_types,
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
};

for (const t of contract.setting_types) {
  if (!settingTypeDocs[t]) throw new Error(`setting type ${t} has no description; add one to scripts/generate.mjs`);
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
const rootAlternation = roots.map((r) => r.name).join("|");

// ---------------------------------------------------------------------------
// Section schema

function setting({ advisory, inObject = false }) {
  const s = {
    type: "object",
    required: inObject ? ["key", "type"] : ["id", "type"],
    properties: {
      ...(inObject
        ? {
            key: { type: "string", minLength: 1, description: "The field's key in the object value." },
            label: { type: "string", description: "The field's editor label." },
          }
        : {
            id: {
              type: "string",
              minLength: 1,
              markdownDescription: "Unique in the section. The template reads `settings.<id>`.",
            },
          }),
      type: {
        ...enumOf(contract.setting_types, (t) => settingTypeDocs[t]),
        markdownDescription: md("The setting type, which decides the editor control.", "/themes/section-schema#setting-types"),
      },
      default: { description: "The value a new section starts with." },
      editor: {
        type: "object",
        markdownDescription:
          "`label` and optional `group`. A setting without `editor` is not shown to merchants. Both can be literal text or keys from `locales/<locale>.schema.json` (`fieldLabel.<label>`, `fieldGroup.<group>`).",
        properties: {
          label: { type: "string", description: "The setting's label in the theme editor." },
          group: { type: "string", description: "The editor group the setting appears in." },
        },
        ...(advisory ? { additionalProperties: false } : {}),
      },
      options: {
        type: "array",
        markdownDescription: "For `select`: the choices.",
        items: {
          type: "object",
          required: ["value", "label"],
          properties: {
            value: { description: "The value the template reads." },
            label: { type: "string", description: "The label merchants see." },
          },
          ...(advisory ? { additionalProperties: false } : {}),
        },
      },
      fields: {
        type: "array",
        markdownDescription: "For `object`: the fields of the value, each with a unique `key`.",
        items: { $ref: "#/definitions/objectField" },
      },
      min: { type: "number", markdownDescription: "For `range` (required) and `number`: the lowest value." },
      max: {
        type: "number",
        markdownDescription: `For \`range\` (required) and \`number\`: the highest value. For \`product_list\` and \`collection_list\`: the most items (${contract.default_resource_list_max} if not set).`,
      },
      step: { type: "number", markdownDescription: "For `range`: the step between values." },
      unit: { type: "string", markdownDescription: "For `range`: the unit shown after the value, such as `px`." },
      visible_if: {
        type: "object",
        markdownDescription: "Show the setting only when another setting has one of the given values.",
        required: ["setting", "values"],
        properties: {
          setting: { type: "string", minLength: 1, description: "The id of the other setting." },
          values: { type: "array", minItems: 1, description: "The values that show this setting." },
        },
        defaultSnippets: [{ body: { setting: "$1", values: ["$2"] } }],
        ...(advisory ? { additionalProperties: false } : {}),
      },
    },
    allOf: [
      {
        if: { properties: { type: { const: "range" } }, required: ["type"] },
        then: { required: ["min", "max"] },
      },
    ],
    defaultSnippets: inObject
      ? [{ label: "field", body: { key: "$1", type: "${2:text}", label: "$3" } }]
      : [
          {
            label: "setting",
            body: { id: "$1", type: "${2:text}", default: "$3", editor: { label: "$4", group: "${5:content}" } },
          },
        ],
  };
  if (advisory) {
    s.additionalProperties = false;
    s.allOf.push(
      {
        if: { properties: { type: { const: "select" } }, required: ["type"] },
        then: { required: ["options"], properties: { options: { minItems: 1 } } },
      },
      {
        if: { properties: { type: { const: "object" } }, required: ["type"] },
        then: { required: ["fields"], properties: { fields: { minItems: 1 } } },
      },
    );
  }
  return s;
}

function sectionSchema({ advisory }) {
  const blockType = {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string", minLength: 1, description: "The block type. Unique in the section." },
      editor: {
        type: "object",
        properties: { label: { type: "string", description: "The block's name in the theme editor." } },
      },
      settings: { type: "array", items: { $ref: "#/definitions/setting" }, description: "The block's settings." },
    },
    defaultSnippets: [
      {
        label: "block type",
        body: {
          type: "$1",
          editor: { label: "$2" },
          settings: [{ id: "$3", type: "${4:text}", default: "$5", editor: { label: "$6", group: "content" } }],
        },
      },
    ],
  };
  if (advisory) {
    blockType.additionalProperties = false;
    blockType.required = ["type", "settings"];
    blockType.properties.settings = { ...blockType.properties.settings, minItems: 1 };
    blockType.properties.editor.additionalProperties = false;
  }
  const blocks = {
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
      accept_app_blocks: { type: "boolean", description: "Accept blocks from the merchant's installed apps." },
    },
    ...(advisory ? { additionalProperties: false } : {}),
  };
  const preset = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, description: "The preset's name in the editor's \"Add section\" list." },
      category: { type: "string", description: "The category the preset is listed under." },
      settings: { type: "object", description: "Values for declared settings." },
      blocks: {
        type: "array",
        description: "Starting blocks: declared block types, or theme:<name> when the section accepts theme blocks.",
        items: {
          type: "object",
          required: ["type"],
          properties: { type: { type: "string" }, settings: { type: "object" } },
        },
      },
    },
    ...(advisory ? { additionalProperties: false } : {}),
  };
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
        ...enumOf(["section", "layout", "embed", "block"], (k) =>
          ({
            section: "A section merchants place on a page (default).",
            layout: "A section for a global surface such as the header or footer. Declares a `target`.",
            embed: "A section for the overlay layer, such as a cart drawer or popup. Declares a `target`.",
            block: "A theme block in `blocks/`. No `target` and no presets.",
          })[k],
        ),
        markdownDescription: md("`section` (default), `layout`, `embed` or `block`.", "/themes/sections#section-kinds"),
      },
      target: {
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
      ctx_needs: {
        type: "array",
        uniqueItems: true,
        markdownDescription: md(
          "The store data the section reads. Declare a root such as `product`, or a dotted need such as `cart.item_count`. A section can read only what it declares.",
          "/ctx/runtime-context",
        ),
        items: {
          type: "string",
          pattern: `^(${rootAlternation})(\\.[A-Za-z_][A-Za-z0-9_]*)*$`,
          errorMessage: "Unknown CTX name. A ctx_needs entry is a CTX root, such as product or cart, optionally followed by a field: cart.item_count.",
          defaultSnippets: ctxNeedEnum.map((label, i) => ({ label, markdownDescription: ctxNeedDocs[i], body: label })),
        },
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
          not: { anyOf: [{ required: ["target"] }, { required: ["presets"] }] },
          properties: {
            blocks: { not: { required: ["types"] } },
          },
        },
      },
    ],
    definitions: {
      setting: setting({ advisory }),
      objectField: setting({ advisory, inObject: true }),
      blocks,
      blockType,
      preset,
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

emit("schemas/section.schema.json", sectionSchema({ advisory: false }));
emit("schemas/section.advisory.schema.json", sectionSchema({ advisory: true }));

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

emit("schemas/settings-schema.schema.json", {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/tringify/vscode-vascula/schemas/settings-schema.schema.json",
  title: "Tringify global theme settings",
  description: "Global theme settings, config/settings_schema.json.",
  type: ["object", "array"],
  if: { type: "object", required: ["settings"] },
  then: {
    properties: {
      schema_version: { type: "integer", description: "The settings schema version." },
      settings: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "type"],
          properties: {
            id: { type: "string", minLength: 1, description: "The template reads settings.<id> in theme tokens and sections." },
            type: {
              anyOf: [
                enumOf([...contract.setting_types, "color_scheme_group", "font_picker"], (t) =>
                  t === "color_scheme_group"
                    ? "The theme's colour schemes: a list of schemes with an `id`, `label` and `colors`, described by `fields`."
                    : t === "font_picker"
                      ? "A font from the platform's font list."
                      : settingTypeDocs[t],
                ),
                { type: "string" },
              ],
            },
            default: {},
            editor: {
              type: "object",
              properties: { label: { type: "string" }, group: { type: "string" } },
            },
            options: {
              type: "array",
              items: { type: "object", required: ["value", "label"], properties: { value: {}, label: { type: "string" } } },
            },
            fields: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } } } },
            min: { type: "number" },
            max: { type: "number" },
            step: { type: "number" },
            unit: { type: "string" },
          },
          allOf: [
            {
              if: { properties: { type: { const: "range" } }, required: ["type"] },
              then: { required: ["min", "max"] },
            },
          ],
        },
      },
    },
  },
});

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
