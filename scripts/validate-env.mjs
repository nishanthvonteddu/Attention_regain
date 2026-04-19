import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENV_CONTRACT, getEnvironmentReport } from "../src/lib/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

async function main() {
  const mode = getMode(process.argv.slice(2));
  const issues = [];
  const exampleContents = await readFile(path.join(ROOT, ".env.example"), "utf8");
  const exampleKeys = parseEnvTemplate(exampleContents);
  const documentedKeys = new Set(ENV_CONTRACT.map((entry) => entry.name));

  for (const key of documentedKeys) {
    if (!exampleKeys.has(key)) {
      issues.push(`.env.example is missing documented key ${key}.`);
    }
  }

  for (const key of exampleKeys) {
    if (!documentedKeys.has(key)) {
      issues.push(`.env.example contains undocumented key ${key}.`);
    }

    if (key.startsWith("NEXT_PUBLIC_") && /(KEY|SECRET|TOKEN|PASSWORD)/i.test(key)) {
      issues.push(`Public env key ${key} looks like a secret and must stay server-only.`);
    }
  }

  const report = getEnvironmentReport(process.env);
  if (mode !== "ci") {
    issues.push(...report.fatalIssues);
  }

  if (issues.length) {
    for (const issue of issues) {
      console.error(issue);
    }
    process.exit(1);
  }

  assert.ok(exampleKeys.has("ENABLE_LIVE_GENERATION"));
  console.log(`environment contract passed in ${mode} mode.`);
}

function getMode(args) {
  const match = args.find((argument) => argument.startsWith("--mode="));
  return match ? match.split("=")[1] : "local";
}

function parseEnvTemplate(contents) {
  return new Set(
    contents
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"))
      .map((line) => line.split("=")[0]?.trim())
      .filter(Boolean),
  );
}

await main();
