import assert from "node:assert/strict";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { processDocumentProcessingJob } from "../src/lib/jobs/document-processing-worker.js";

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

  const { POST, GET } = await import("../src/app/api/study-feed/route.js");
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

        assert.equal(response.status, 202);
        await processDocumentProcessingJob({ jobId: payload.job.id });

        const workspaceResponse = await GET(
          new Request("http://localhost/api/study-feed", {
            method: "GET",
            headers: {
              cookie: `attention_regain_session=${sessionCookie}`,
            },
          }),
        );
        const workspace = await workspaceResponse.json();

        assert.equal(workspaceResponse.status, 200);
        assert.equal(workspace.deck.generationMode, "fallback");
        assert.equal(workspace.deck.stats.parseStatus, "parsed");
        assert.ok(workspace.deck.stats.pageCount > 0);
        assert.ok(workspace.deck.stats.extractedWordCount > 0);
        assert.ok(Array.isArray(workspace.deck.cards));
        assert.ok(workspace.deck.cards.length > 0);
        assert.ok(workspace.deck.cards.every((card) => /^Page \d+/.test(card.citation)));
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
