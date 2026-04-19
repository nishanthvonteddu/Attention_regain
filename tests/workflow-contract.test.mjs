import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("delivery scripts are present and discoverable", async () => {
  await access(new URL("../scripts/lint.sh", import.meta.url));
  await access(new URL("../scripts/build.sh", import.meta.url));
  await access(new URL("../scripts/test.sh", import.meta.url));
  await access(new URL("../scripts/check.sh", import.meta.url));
  await access(new URL("../scripts/validate-env.mjs", import.meta.url));
  await access(new URL("../.github/workflows/ci.yml", import.meta.url));
});

test("workflow docs define branch and delivery expectations", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const workflowDoc = await readFile(
    new URL("../docs/delivery-workflow.md", import.meta.url),
    "utf8",
  );
  const setupDoc = await readFile(
    new URL("../docs/setup-and-release.md", import.meta.url),
    "utf8",
  );
  const ciWorkflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(readme, /day-<number>\/<slug>/);
  assert.match(readme, /docs\/environment-contract\.md/);
  assert.match(workflowDoc, /day-<number>\/<slug>/);
  assert.match(workflowDoc, /lowest-numbered open child issue first/);
  assert.match(workflowDoc, /Do not work directly on `main`\./);
  assert.match(workflowDoc, /CI is green/);
  assert.match(setupDoc, /AWS Inventory Assumptions/);
  assert.match(ciWorkflow, /node scripts\/validate-env\.mjs --mode=ci/);
  assert.match(ciWorkflow, /bash scripts\/lint\.sh/);
  assert.match(ciWorkflow, /bash scripts\/build\.sh/);
  assert.match(ciWorkflow, /bash scripts\/test\.sh/);
});
