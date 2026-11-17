#!/usr/bin/env node
// Fetches Canvas, Tringify's default theme, used as the test corpus, at a pinned commit.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CANVAS_COMMIT = "dc09f7b0f38139c8821b534eb910bf4f4069d8a5";
const dir = join(dirname(fileURLToPath(import.meta.url)), ".canvas");
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "inherit" });

if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
execFileSync("git", ["init", "-q", dir]);
git("remote", "add", "origin", "https://github.com/tringify/canvas.git");
git("fetch", "-q", "--depth", "1", "origin", process.env.CANVAS_REF ?? CANVAS_COMMIT);
git("checkout", "-q", "FETCH_HEAD");
console.log(`tringify/canvas at ${process.env.CANVAS_REF ?? CANVAS_COMMIT} in ${dir}`);
