#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createEmptyJsonStore, normalizeJsonStore } from "../src/lib/data/schema.js";

const FIXTURE_URL = new URL("../db/fixtures/day03-local-seed.json", import.meta.url);

async function main() {
  const mode = process.argv.includes("--empty") ? "empty" : "seed";
  const store = createLocalJsonStore();
  const seed = mode === "empty"
    ? createEmptyJsonStore()
    : normalizeJsonStore(JSON.parse(await readFile(FIXTURE_URL, "utf8")));
  await store.reset(seed);
  console.log(`[reset-local-data] wrote ${mode} store to ${store.filePath}`);
}

await main();
