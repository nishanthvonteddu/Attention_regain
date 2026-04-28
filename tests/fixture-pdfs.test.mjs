import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { waitForScheduledDocumentJobs } from "../src/lib/jobs/document-processing-worker.js";

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
        const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-fixture-"));
        const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
        process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;

        try {
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
          await response.json();

          assert.equal(response.status, 202);

          const { workspaceResponse, workspace } = await waitForReadyWorkspace({
            GET,
            sessionCookie,
          });

          assert.equal(workspaceResponse.status, 200);
          assert.equal(workspace.deck.generationMode, "fallback");
          assert.equal(workspace.deck.stats.parseStatus, "parsed");
          assert.ok(workspace.deck.stats.pageCount > 0);
          assert.ok(workspace.deck.stats.extractedWordCount > 0);
          assert.ok(Array.isArray(workspace.deck.cards));
          assert.ok(workspace.deck.cards.length > 0);
          assert.ok(workspace.deck.cards.every((card) => /^Page \d+/.test(card.citation)));
        } finally {
          await waitForScheduledDocumentJobs();
          if (typeof previousDataDir === "string") {
            process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
          } else {
            delete process.env.ATTENTION_REGAIN_DATA_DIR;
          }
          await rm(dataDir, { recursive: true, force: true });
        }
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

async function waitForReadyWorkspace({ GET, sessionCookie }) {
  let latestResponse = null;
  let latestWorkspace = null;

  for (let attempt = 0; attempt < 160; attempt += 1) {
    latestResponse = await GET(
      new Request("http://localhost/api/study-feed", {
        method: "GET",
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    latestWorkspace = await latestResponse.json();
    if (latestWorkspace.deck && latestWorkspace.job?.status === "succeeded") {
      return { workspaceResponse: latestResponse, workspace: latestWorkspace };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.fail(`Timed out waiting for ready fixture workspace: ${JSON.stringify(latestWorkspace)}`);
  return { workspaceResponse: latestResponse, workspace: latestWorkspace };
}
