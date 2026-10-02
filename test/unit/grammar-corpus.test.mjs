// Tokenizes every .vasc file of the theme starter with the extension's grammar and
// VS Code's HTML, CSS, JavaScript and JSON grammars, and checks that no Vascula
// markup is left untokenized and nothing is marked invalid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { core, starterDir, files, read, root } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const grammarFiles = {
  "text.html.vascula": "syntaxes/vascula.tmLanguage.json",
  "text.html.basic": "test/fixtures/grammars/html.tmLanguage.json",
  "text.html.derivative": "test/fixtures/grammars/html-derivative.tmLanguage.json",
  "source.css": "test/fixtures/grammars/css.tmLanguage.json",
  "source.js": "test/fixtures/grammars/javascript.tmLanguage.json",
  "source.json": "test/fixtures/grammars/json.tmLanguage.json",
};

async function loadGrammar() {
  const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p) => new oniguruma.OnigScanner(p),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope) => {
      const f = grammarFiles[scope];
      return f ? vsctm.parseRawGrammar(readFileSync(join(root, f), "utf8"), join(root, f)) : null;
    },
  });
  return registry.loadGrammar("text.html.vascula");
}

function tokenize(grammar, text) {
  const lines = text.split("\n");
  let stack = vsctm.INITIAL;
  const tokens = [];
  let offset = 0;
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, stack);
    for (const t of r.tokens) {
      tokens.push({ start: offset + t.startIndex, end: offset + Math.min(t.endIndex, line.length), scopes: t.scopes });
    }
    stack = r.ruleStack;
    offset += line.length + 1;
  }
  return { tokens, endStack: stack };
}

const OPENERS = /\{\{|\{%|\{#/g;

test("every starter .vasc file tokenizes fully", async () => {
  const grammar = await loadGrammar();
  const vasc = [...files(join(starterDir, "sections"), ".vasc"), ...files(join(starterDir, "blocks"), ".vasc")];
  assert.ok(vasc.length >= 40);
  // Section sources edited before `tringify-theme build`: markup only, no schema block.
  const bodies = files(join(starterDir, "src/sections"), "body.html");
  assert.ok(bodies.length >= 30);
  vasc.push(...bodies);
  let markupCount = 0;
  for (const f of vasc) {
    const name = relative(starterDir, f);
    const text = read(f);
    const { tokens } = tokenize(grammar, text);
    const at = (offset) => tokens.find((t) => offset >= t.start && offset < t.end);

    for (const t of tokens) {
      const bad = t.scopes.find((s) => s.startsWith("invalid"));
      assert.ok(!bad, `${name}: ${bad} at ${JSON.stringify(text.slice(t.start, t.end))}`);
    }

    // Every opener outside comments and the schema starts a Vascula token.
    const masked = core.regions.maskComments(text);
    const isBody = name.endsWith("body.html");
    const schema = core.regions.findSchemaBlocks(text)[0] ?? { contentStart: -1, contentEnd: -1, closed: isBody };
    assert.ok(schema.closed && (isBody || schema.contentStart > 0), `${name}: schema block`);
    let m;
    OPENERS.lastIndex = 0;
    while ((m = OPENERS.exec(masked))) {
      if (m.index > schema.contentStart && m.index < schema.contentEnd) continue;
      const t = at(m.index);
      assert.ok(t, `${name}: no token at ${m.index}`);
      const top = t.scopes[t.scopes.length - 1];
      assert.ok(
        /^punctuation\.(section\.embedded|definition\.comment)\.begin\.vascula$/.test(top),
        `${name}: ${JSON.stringify(text.slice(m.index, m.index + 30))} tokenized as ${t.scopes.join(" ")}`,
      );
      markupCount++;
    }

    // Inside output and tags, every non-space character has a specific scope.
    for (const t of tokens) {
      const top = t.scopes[t.scopes.length - 1];
      if ((top === "meta.output.vascula" || top === "meta.tag.vascula") && text.slice(t.start, t.end).trim()) {
        assert.fail(`${name}: untokenized ${JSON.stringify(text.slice(t.start, t.end))} inside Vascula markup, in ${JSON.stringify(text.slice(t.start - 60, t.end + 20))}`);
      }
    }

    // The schema's JSON is tokenized as JSON.
    for (let o = schema.contentStart; o < schema.contentEnd; o++) {
      if (/\s/.test(text[o])) continue;
      const t = at(o);
      assert.ok(t && t.scopes.includes("source.json"), `${name}: schema offset ${o} not JSON`);
    }

    // Nothing is left open at the end of the file: markup after it is plain Vascula-in-HTML.
    const probeText = text + "\n<p>{{ probe }}</p>";
    const probeAt = probeText.lastIndexOf("probe");
    const probe = tokenize(grammar, probeText).tokens.find((t) => probeAt >= t.start && probeAt < t.end);
    assert.deepEqual(
      probe.scopes.filter((s) => !s.startsWith("meta.") || s === "meta.output.vascula"),
      ["text.html.vascula", "meta.output.vascula", "variable.other.vascula"],
      `${name}: state leaks past the end of the file`,
    );
  }
  assert.ok(markupCount > 1000, `checked ${markupCount} markup openers`);
});
