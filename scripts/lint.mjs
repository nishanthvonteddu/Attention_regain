import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIRECTORIES = [".github", "src", "docs", "scripts", "tests"];
const ROOT_FILES = [".env.example", "README.md", "package.json"];
const TEXT_EXTENSIONS = new Set([".css", ".js", ".json", ".md", ".mjs", ".sh", ".yml"]);
const REQUIRED_SCRIPT_FILES = [
  "scripts/lint.sh",
  "scripts/build.sh",
  "scripts/test.sh",
  "scripts/check.sh",
];

const issues = [];

async function main() {
  const files = new Set();

  for (const file of ROOT_FILES) {
    files.add(path.join(ROOT, file));
  }

  for (const directory of DIRECTORIES) {
    await collectFiles(path.join(ROOT, directory), files);
  }

  for (const file of Array.from(files).sort()) {
    await lintFile(file);
  }

  await lintRepositoryScripts();

  if (issues.length) {
    for (const issue of issues) {
      console.error(issue);
    }
    console.error(`lint failed with ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log(`lint passed for ${files.size} file(s).`);
}

async function collectFiles(directory, files) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await collectFiles(fullPath, files);
        continue;
      }

      if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        files.add(fullPath);
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

async function lintFile(file) {
  const relativePath = path.relative(ROOT, file);
  const contents = await readFile(file, "utf8");
  const lines = contents.split("\n");

  lines.forEach((line, index) => {
    if (line.includes("\t")) {
      issues.push(`${relativePath}:${index + 1} contains a tab character.`);
    }

    if (/[ \t]+$/.test(line)) {
      issues.push(`${relativePath}:${index + 1} has trailing whitespace.`);
    }
  });

  if (!contents.endsWith("\n")) {
    issues.push(`${relativePath} is missing a trailing newline.`);
  }
}

async function lintRepositoryScripts() {
  for (const relativePath of REQUIRED_SCRIPT_FILES) {
    try {
      await readFile(path.join(ROOT, relativePath), "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        issues.push(`${relativePath} is missing.`);
        continue;
      }

      throw error;
    }
  }
}

await main();
