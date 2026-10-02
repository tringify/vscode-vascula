// eslint-disable-next-line @typescript-eslint/no-var-requires
const data: { filters: Filter[] } = require("../data/filters.json");

export interface Filter {
  name: string;
  source: "vascula" | "tringify";
  group: string;
  signature: string;
  doc: string;
  example: string;
  url?: string;
}

export const filters: Filter[] = data.filters;
const byName = new Map(filters.map((f) => [f.name, f]));

export function filter(name: string): Filter | undefined {
  return byName.get(name);
}

export function filterMarkdown(f: Filter): string {
  const origin = f.source === "vascula" ? "Vascula built-in" : "Tringify platform filter";
  const url = f.url ?? `https://vascula.dev/filters#${f.name.replace(/_/g, "-")}`;
  return [
    "```vascula",
    `| ${f.signature}`,
    "```",
    `${origin} · ${f.group}`,
    "",
    f.doc,
    "",
    "```vascula",
    f.example,
    "```",
    "",
    `[Documentation](${url})`,
  ].join("\n");
}

export const TAGS: { name: string; doc: string; snippet?: string }[] = [
  { name: "if", doc: "Render when a condition is true.", snippet: "if ${1:condition} %}\n\t$0\n{% endif" },
  { name: "elsif", doc: "Another condition inside `if`." },
  { name: "else", doc: "The fallback branch of `if`, `unless`, `case` or `for`." },
  { name: "endif", doc: "Ends `if`." },
  { name: "unless", doc: "Render when a condition is false.", snippet: "unless ${1:condition} %}\n\t$0\n{% endunless" },
  { name: "endunless", doc: "Ends `unless`." },
  { name: "case", doc: "Choose a branch by value.", snippet: "case ${1:value} %}\n\t{% when ${2:\"a\"} %}\n\t\t$0\n{% endcase" },
  { name: "when", doc: "A branch of `case`. Separate values with `,` or `or`." },
  { name: "endcase", doc: "Ends `case`." },
  { name: "for", doc: "Repeat for each item. Modifiers: `limit:`, `offset:`, `reversed`.", snippet: "for ${1:item} in ${2:items} %}\n\t$0\n{% endfor" },
  { name: "endfor", doc: "Ends `for`." },
  { name: "break", doc: "Leave the current loop." },
  { name: "continue", doc: "Skip to the next iteration." },
  { name: "cycle", doc: "Print the next value in turn on each iteration." },
  { name: "assign", doc: "Set a variable: `assign name = value`." },
  { name: "capture", doc: "Set a variable to rendered text.", snippet: "capture ${1:name} %}\n\t$0\n{% endcapture" },
  { name: "endcapture", doc: "Ends `capture`." },
  { name: "render", doc: "Render another template with its own variables: `render \"name\", key: value`." },
  { name: "form", doc: "A hosted form. The first argument is the form kind.", snippet: "form '${1:cart_add}' %}\n\t$0\n{% endform" },
  { name: "endform", doc: "Ends `form`." },
  { name: "blocks", doc: "Render the section's theme and app blocks in the merchant's order, or one block: `blocks b`." },
  { name: "comment", doc: "Ignore everything up to `endcomment`, including tags.", snippet: "comment %}\n\t$0\n{% endcomment" },
  { name: "endcomment", doc: "Ends `comment`." },
  { name: "schema", doc: "The section's JSON schema. Prints nothing.", snippet: "schema %}\n{\n\t\"name\": \"$1\",\n\t\"settings\": [$0]\n}\n{% endschema" },
  { name: "endschema", doc: "Ends `schema`." },
];
