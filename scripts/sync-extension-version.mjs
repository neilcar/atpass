#!/usr/bin/env node
// Stamps extension/public/manifest.json's "version" with the root package.json
// version, so a release tag only has to be bumped in one place instead of
// drifting out of sync the way the CLI's hardcoded --version string used to
// (see the "Sanity-check the built CLI" step in the release workflow).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const manifestPath = join(repoRoot, "extension", "public", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`extension/public/manifest.json version set to ${pkg.version}`);
