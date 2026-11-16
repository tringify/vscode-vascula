#!/usr/bin/env node
// Reads the JSON fields of the platform's theme-file structs from the theme check source
// and writes data/platform-fields.json, which scripts/generate.mjs checks the schemas against.
//
//   node scripts/platform-fields.mjs --source DIR [--check]
//
// DIR is a checkout of the Go module the theme tools are built from (the module with
// cmd/themecheck and vascula/). Use the commit whose `themecheck -contract` output matches
// data/contract.json. `tringify theme contract` carries the vocabularies (setting types, CTX
// names, migration operations) but not the field lists of a section schema, so they come
// from the structs the upload check decodes the schema into.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const sourceArg = args.indexOf("--source");
if (sourceArg < 0 || !args[sourceArg + 1]) {
  console.error("usage: node scripts/platform-fields.mjs --source DIR [--check]");
  process.exit(2);
}
const src = args[sourceArg + 1];

// The structs a theme file is decoded into, by file. Every field with a JSON name is listed.
const STRUCTS = {
  "vascula/section.go": [
    "sectionSchema", // the {% schema %} block
    "SettingDef",
    "VisibleIf",
    "OptionDef",
    "ObjectFieldDef",
    "EditorMeta",
    "BlockSchema",
    "BlockTypeDef",
    "PresetDef",
    "PresetBlock",
  ],
  "vascula/migrations.go": ["Migration", "SettingLocation", "MigrationBlock"],
  "vascula/settings_schema.go": ["SettingsSchema"], // config/settings_schema.json
};

// Closed vocabularies the contract does not carry: `var name = map[string]bool{...}` keys.
const MAPS = {
  "vascula/metafield_setting.go": ["metafieldSettingOwners"],
};
// String lists: `var name = []string{...}`.
const LISTS = {
  "vascula/interpreter/interpreter.go": ["StorefrontFilters"], // filters the storefront adds; theme check refuses others
};
// Integer constants: `const name = 1`.
const CONSTS = {
  "vascula/settings_schema.go": ["settingsSchemaVersion"],
};

function structFields(text, name, file) {
  const start = text.search(new RegExp(`^type ${name} struct \\{`, "m"));
  if (start < 0) throw new Error(`${file}: struct ${name} not found`);
  const body = text.slice(text.indexOf("{", start) + 1);
  const fields = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const code = line.replace(/\/\/.*$/, "");
    if (depth === 0 && /^\s*\}/.test(code)) return fields;
    depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
    const m = code.match(/^\s*(\w+)\s+([^`]+?)\s+`[^`]*json:"([^",]*)/);
    if (!m || m[3] === "-") continue;
    fields.push({ name: m[3] || m[1], go: m[2].trim(), omitempty: /json:"[^"]*,omitempty/.test(code) });
  }
  throw new Error(`${file}: struct ${name} is not closed`);
}

function mapKeys(text, name, file) {
  const start = text.search(new RegExp(`^var ${name} = map\\[string\\]bool\\{`, "m"));
  if (start < 0) throw new Error(`${file}: map ${name} not found`);
  const body = text.slice(start, text.indexOf("\n}", start));
  return [...body.matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]).sort();
}

let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout */
}

const out = { source: `${commit} (vascula/*.go)`, structs: {}, values: {} };
for (const [file, names] of Object.entries(STRUCTS)) {
  const text = readFileSync(join(src, file), "utf8");
  for (const n of names) out.structs[n] = structFields(text, n, file);
}
for (const [file, names] of Object.entries(MAPS)) {
  const text = readFileSync(join(src, file), "utf8");
  for (const n of names) out.values[n] = mapKeys(text, n, file);
}

for (const [file, names] of Object.entries(CONSTS)) {
  const text = readFileSync(join(src, file), "utf8");
  for (const n of names) {
    const m = text.match(new RegExp(`^const ${n} = (\\d+)$`, "m"));
    if (!m) throw new Error(`${file}: const ${n} not found`);
    out.values[n] = Number(m[1]);
  }
}

for (const [file, names] of Object.entries(LISTS)) {
  const text = readFileSync(join(src, file), "utf8");
  for (const n of names) {
    const start = text.search(new RegExp(`^var ${n} = \\[\\]string\\{`, "m"));
    if (start < 0) throw new Error(`${file}: list ${n} not found`);
    const body = text.slice(start, text.indexOf("\n}", start));
    out.values[n] = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  }
}

// Vascula's built-in filters (engine.IsBuiltinFilter), from the engine version the module pins.
{
  const dir = execFileSync("go", ["list", "-m", "-f", "{{.Dir}} {{.Version}}", "vascula.dev/vascula"], { cwd: src, encoding: "utf8" }).trim();
  const [engineDir, version] = dir.split(" ");
  const text = readFileSync(join(engineDir, "filters.go"), "utf8");
  const start = text.search(/^func builtinFilters\(\) map\[string\]FilterFunc \{/m);
  if (start < 0) throw new Error("vascula.dev/vascula filters.go: builtinFilters not found");
  const body = text.slice(start, text.indexOf("\n}\n", start));
  out.values.vasculaBuiltinFilters = [...body.matchAll(/^\t\t"([a-z_]+)":/gm)].map((m) => m[1]).sort();
  out.source += `; vascula.dev/vascula ${version} (filters.go)`;
}

const target = join(root, "data/platform-fields.json");
const text = JSON.stringify(out, null, 2) + "\n";
const strip = (t) => t.replace(/"source": "[^"]*"/, "");
if (check) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (strip(current) !== strip(text)) {
    console.error(`data/platform-fields.json differs from ${src}. Run node scripts/platform-fields.mjs --source ${src}, then npm run generate.`);
    process.exit(1);
  }
  console.log("data/platform-fields.json matches the platform source.");
} else {
  writeFileSync(target, text);
  console.log(`Wrote data/platform-fields.json from ${src} at ${commit}.`);
}
