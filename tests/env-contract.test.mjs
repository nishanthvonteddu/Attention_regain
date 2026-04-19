import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ENV_CONTRACT, getEnvironmentReport, getTextGenerationConfig } from "../src/lib/env.js";

test(".env.example covers the documented environment contract", async () => {
  const contents = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  for (const entry of ENV_CONTRACT) {
    assert.match(contents, new RegExp(`^${entry.name}=`, "m"));
  }
});

test("live generation misconfiguration produces a defined failure path", () => {
  const report = getEnvironmentReport({
    ENABLE_LIVE_GENERATION: "true",
  });

  assert.equal(report.generation.enabled, false);
  assert.match(
    report.fatalIssues.join("\n"),
    /no NVIDIA text-generation key is configured/i,
  );
});

test("legacy and preferred text generation keys both map to the runtime config", () => {
  const preferred = getTextGenerationConfig({
    ENABLE_LIVE_GENERATION: "true",
    NVIDIA_TEXT_API_KEY: "text-key",
    NVIDIA_TEXT_MODEL: "preferred-model",
  });
  const legacy = getTextGenerationConfig({
    ENABLE_LIVE_GENERATION: "true",
    NVIDIA_API_KEY: "legacy-key",
    NVIDIA_MODEL: "legacy-model",
  });

  assert.equal(preferred.enabled, true);
  assert.equal(preferred.apiKey, "text-key");
  assert.equal(preferred.model, "preferred-model");
  assert.equal(legacy.enabled, true);
  assert.equal(legacy.apiKey, "legacy-key");
  assert.equal(legacy.model, "legacy-model");
});
