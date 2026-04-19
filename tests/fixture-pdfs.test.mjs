import assert from "node:assert/strict";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";

const FIXTURES = [
  "/Users/work/Downloads/AIAYN.pdf",
  "/Users/work/Downloads/SAM.pdf",
  "/Users/work/Downloads/OPUS.pdf",
];

test("local PDF fixtures generate grounded fallback decks when available", async (t) => {
  const available = [];

  for (const fixture of FIXTURES) {
    try {
      await access(fixture);
      available.push(fixture);
    } catch {
      // Ignore missing local fixtures so CI can still run.
    }
  }

  if (!available.length) {
    t.skip("Local PDF fixtures are not present on this machine.");
    return;
  }

  const previousTextApiKey = process.env.NVIDIA_TEXT_API_KEY;
  const previousLegacyKey = process.env.NVIDIA_API_KEY;
  const previousEnableLiveGeneration = process.env.ENABLE_LIVE_GENERATION;

  process.env.ENABLE_LIVE_GENERATION = "false";
  delete process.env.NVIDIA_TEXT_API_KEY;
  delete process.env.NVIDIA_API_KEY;

  const { POST } = await import("../src/app/api/study-feed/route.js");
  const sessionCookie = serializeProductSession(
    createAuthenticatedProductSession({
      userId: "local-reader",
      email: "reader@example.com",
      displayName: "Focused Reader",
      source: "fixture-test",
    }),
  );

  try {
    for (const fixture of available) {
      await t.test(path.basename(fixture), async () => {
        const bytes = await readFile(fixture);
        const formData = new FormData();
        formData.set("title", path.basename(fixture, ".pdf"));
        formData.set("goal", "validate the local study feed on a real source");
        formData.set(
          "file",
          new File([bytes], path.basename(fixture), { type: "application/pdf" }),
        );

        const response = await POST(
          new Request("http://localhost/api/study-feed", {
            method: "POST",
            body: formData,
            headers: {
              cookie: `attention_regain_session=${sessionCookie}`,
            },
          }),
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.generationMode, "fallback");
        assert.ok(Array.isArray(payload.cards));
        assert.ok(payload.cards.length > 0);
        assert.ok(payload.cards.every((card) => typeof card.citation === "string" && card.citation));
      });
    }
  } finally {
    if (typeof previousEnableLiveGeneration === "string") {
      process.env.ENABLE_LIVE_GENERATION = previousEnableLiveGeneration;
    } else {
      delete process.env.ENABLE_LIVE_GENERATION;
    }

    if (typeof previousTextApiKey === "string") {
      process.env.NVIDIA_TEXT_API_KEY = previousTextApiKey;
    } else {
      delete process.env.NVIDIA_TEXT_API_KEY;
    }

    if (typeof previousLegacyKey === "string") {
      process.env.NVIDIA_API_KEY = previousLegacyKey;
    } else {
      delete process.env.NVIDIA_API_KEY;
    }
  }
});
