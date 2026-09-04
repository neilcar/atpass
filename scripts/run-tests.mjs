#!/usr/bin/env node
// Finds test/*.test.ts ourselves instead of relying on shell glob expansion
// for the file list: bash doesn't expand `**` by default (needs `shopt -s
// globstar`), and Windows runners use PowerShell for `run:` steps, which
// doesn't expand glob arguments for external commands the way bash does
// either. Pure Node fs.readdirSync + spawnSync behaves identically on every
// OS, which is what actually broke in CI (see the release workflow).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(repoRoot, "test");

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join("test", f));

if (files.length === 0) {
  console.error("No test files found in test/ (looked for *.test.ts).");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
