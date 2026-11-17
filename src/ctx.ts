// The CTX data model from the theme author contract.

export interface HostedAction {
  kind: string;
  group: string;
  path: string;
  form_capable: boolean;
  multipart: boolean;
  fields: { name: string; required: boolean; description: string }[];
}

interface Contract {
  setting_types: string[];
  ctx: { definitions: Record<string, CtxSchema>; roots: CtxRoot[] };
  hosted_actions: HostedAction[];
}

// Loaded untyped: the contract is large, and its shape is declared above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contract: Contract = require("../data/contract.json");

export interface CtxSchema {
  type?: string;
  ref?: string;
  nullable?: boolean;
  properties?: { name: string; required?: boolean; schema: CtxSchema }[];
  items?: CtxSchema;
  additional_properties?: CtxSchema;
  enum?: unknown[];
}

export interface CtxRoot {
  name: string;
  availability: string;
  page_types?: string[];
  description: string;
  schema: CtxSchema;
}

export interface CtxField {
  name: string;
  type: string;
  required: boolean;
}

const definitions = contract.ctx.definitions;
export const roots: CtxRoot[] = contract.ctx.roots;
const byName = new Map(roots.map((r) => [r.name, r]));

export function root(name: string): CtxRoot | undefined {
  return byName.get(name);
}

export function resolve(schema: CtxSchema | undefined): CtxSchema | undefined {
  let s = schema;
  let ref: string | undefined;
  for (let i = 0; s && s.ref && i < 8; i++) {
    ref = s.ref;
    const nullable = s.nullable;
    s = definitions[s.ref];
    if (s && nullable) s = { ...s, nullable: true };
  }
  return s && ref && !s.ref ? { ...s, ref } : s;
}

export function typeLabel(schema: CtxSchema | undefined): string {
  if (!schema) return "unknown";
  const named = schema.ref;
  const s = resolve(schema);
  if (!s) return named ?? "unknown";
  let label: string;
  if (s.type === "array") label = `array of ${typeLabel(s.items)}`;
  else if (named) label = named;
  else if (s.type === "object" && s.additional_properties) label = `map of ${typeLabel(s.additional_properties)}`;
  else label = s.type ?? "value";
  return (s.nullable || schema.nullable) ? `${label} or nil` : label;
}

/** The schema reached by following a path from a CTX root, such as ["product", "price"]. */
export function schemaAt(path: string[]): CtxSchema | undefined {
  const r = byName.get(path[0]);
  if (!r) return undefined;
  let schema: CtxSchema | undefined = r.schema;
  for (const seg of path.slice(1)) {
    const s = resolve(schema);
    if (!s) return undefined;
    if (s.type === "array") {
      if (seg === "first" || seg === "last" || seg === "[]") schema = s.items;
      else return undefined;
    } else if (s.type === "object" && s.properties) {
      const p = s.properties.find((x) => x.name === seg);
      if (p) schema = p.schema;
      else if (s.additional_properties) schema = s.additional_properties;
      else return undefined;
    } else if (s.type === "object" && s.additional_properties) {
      schema = s.additional_properties;
    } else {
      return undefined;
    }
  }
  return schema;
}

/** The fields offered after `<path>.`. */
export function fieldsAt(path: string[]): CtxField[] {
  const s = resolve(schemaAt(path));
  if (!s) return [];
  if (s.type === "array") {
    return [
      { name: "first", type: typeLabel(s.items), required: false },
      { name: "last", type: typeLabel(s.items), required: false },
      { name: "size", type: "integer", required: true },
    ];
  }
  if (s.type === "object" && s.properties) {
    return s.properties.map((p) => ({ name: p.name, type: typeLabel(p.schema), required: !!p.required }));
  }
  return [];
}

export function availabilityText(r: CtxRoot): string {
  const pages = r.page_types?.map((p) => "`" + p + "`").join(", ");
  switch (r.availability) {
    case "route":
      return pages ? `Provided on ${pages} pages.` : "Provided on its own pages.";
    case "always":
      return "Available on every page.";
    case "notice":
      return "Present after a hosted form submission.";
    default:
      return pages ? `Requested; provided on ${pages} pages.` : "Requested data, available on normal storefront pages.";
  }
}

export const hostedActions: HostedAction[] = contract.hosted_actions;
export const settingTypes: string[] = contract.setting_types;
