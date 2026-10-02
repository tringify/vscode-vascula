#!/usr/bin/env node
// Fetches the theme starter used as the test corpus, at a pinned commit.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const STARTER_COMMIT = "dc439656a7c7c999dba5be749b0828bdfa727fc2";
const dir = join(dirname(fileURLToPath(import.meta.url)), ".starter");
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "inherit" });

if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
execFileSync("git", ["init", "-q", dir]);
git("remote", "add", "origin", "https://github.com/tringify/theme-starter.git");
git("fetch", "-q", "--depth", "1", "origin", process.env.STARTER_REF ?? STARTER_COMMIT);
git("checkout", "-q", "FETCH_HEAD");
console.log(`theme-starter at ${process.env.STARTER_REF ?? STARTER_COMMIT} in ${dir}`);
