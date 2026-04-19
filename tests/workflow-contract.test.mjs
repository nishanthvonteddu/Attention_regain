import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("delivery scripts are present and discoverable", async () => {
  await access(new URL("../scripts/lint.sh", import.meta.url));
  await access(new URL("../scripts/build.sh", import.meta.url));
  await access(new URL("../scripts/test.sh", import.meta.url));
  await access(new URL("../scripts/check.sh", import.meta.url));
});

test("workflow docs define branch and delivery expectations", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const workflowDoc = await readFile(
    new URL("../docs/delivery-workflow.md", import.meta.url),
    "utf8",
  );

  assert.match(readme, /scripts\/check\.sh/);
  assert.match(workflowDoc, /codex\/day-XX-<slug>/);
  assert.match(workflowDoc, /lowest-numbered open child issue first/);
  assert.match(workflowDoc, /Do not work directly on `main`\./);
});
