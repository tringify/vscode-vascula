import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

/** The bundled, VS Code-free part of the extension (built by `npm run build:core`). */
export const core = require(join(root, "out/core.js"));

/** A checkout of https://github.com/tringify/canvas, Canvas (see test/fetch-canvas.mjs). */
export const canvasDir = process.env.CANVAS_DIR ?? join(root, "test/.canvas");
if (!existsSync(join(canvasDir, "theme.json"))) {
  throw new Error(`No Canvas checkout at ${canvasDir}. Run: node test/fetch-canvas.mjs`);
}

export function files(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

export const read = (p) => readFileSync(p, "utf8");
export const readJson = (p) => JSON.parse(read(p));
