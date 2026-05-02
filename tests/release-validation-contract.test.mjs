import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { waitForScheduledDocumentJobs } from "../src/lib/jobs/document-processing-worker.js";
import { resetRateLimitState } from "../src/lib/security/rate-limit.js";

test("Day 14 release candidate flow covers happy path, resume, and study actions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-release-flow-"));
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const previousEnableLiveGeneration = process.env.ENABLE_LIVE_GENERATION;
  const previousTextApiKey = process.env.NVIDIA_TEXT_API_KEY;
  const previousLegacyKey = process.env.NVIDIA_API_KEY;

  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;
  process.env.ENABLE_LIVE_GENERATION = "false";
  delete process.env.NVIDIA_TEXT_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  resetRateLimitState();

  try {
    const { POST, GET, PATCH } = await import("../src/app/api/study-feed/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "release-reader",
        email: "release@example.com",
        displayName: "Release Reader",
        source: "release-validation",
      }),
    );
    const requestHeaders = {
      cookie: `attention_regain_session=${sessionCookie}`,
      origin: "http://localhost",
      host: "localhost",
    };
    const formData = new FormData();
    formData.set("title", "Release validation source");
    formData.set("goal", "validate upload to study-feed release behavior");
    formData.set("sourceText", buildReleaseSourceText());

    const response = await POST(
      new Request("http://localhost/api/study-feed", {
        method: "POST",
        body: formData,
        headers: requestHeaders,
      }),
    );
    const accepted = await response.json();

    assert.equal(response.status, 202);
    assert.equal(accepted.accepted, true);

    const workspace = await waitForReadyWorkspace({ GET, requestHeaders });
    assert.equal(workspace.resume.available, true);
    assert.equal(workspace.resume.status, "ready");
    assert.equal(workspace.document.status, "cards_generated");
    assert.equal(workspace.deck.generationMode, "fallback");
    assert.ok(workspace.deck.cards.length > 0);
    assert.ok(workspace.deck.cards.every((card) => card.citation && card.sourceReference));
    assert.ok(workspace.deck.stats.retrievedChunkCount > 0);
    assert.equal(workspace.deck.persistence.serverStored, true);

    const firstCard = workspace.deck.cards[0];
    const interactionResponse = await PATCH(
      new Request("http://localhost/api/study-feed", {
        method: "PATCH",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: workspace.deck.sessionId,
          cardId: firstCard.id,
          interactionType: "set_confidence",
          value: "review",
        }),
      }),
    );

    assert.equal(interactionResponse.status, 200);

    const resumed = await loadWorkspace({ GET, requestHeaders });
    assert.equal(resumed.deck.feedback[firstCard.id].confidence, "review");
    assert.equal(resumed.deck.progress.reviewAgainCards, 1);
  } finally {
    await waitForScheduledDocumentJobs();
    resetRateLimitState();
    restoreEnv("ATTENTION_REGAIN_DATA_DIR", previousDataDir);
    restoreEnv("ENABLE_LIVE_GENERATION", previousEnableLiveGeneration);
    restoreEnv("NVIDIA_TEXT_API_KEY", previousTextApiKey);
    restoreEnv("NVIDIA_API_KEY", previousLegacyKey);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Day 14 release candidate flow rejects known bad inputs before generation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-release-failure-"));
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;

  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;
  resetRateLimitState();

  try {
    const { POST: createUpload } = await import("../src/app/api/document-uploads/route.js");
    const { POST: createFeed } = await import("../src/app/api/study-feed/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "failure-reader",
        email: "failure@example.com",
        displayName: "Failure Reader",
        source: "release-validation",
      }),
    );
    const requestHeaders = {
      cookie: `attention_regain_session=${sessionCookie}`,
      origin: "http://localhost",
      host: "localhost",
    };

    const uploadResponse = await createUpload(
      new Request("http://localhost/api/document-uploads", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Bad upload",
          goal: "validate failure path",
          fileName: "installer.exe",
          contentType: "application/x-msdownload",
          sizeBytes: 42,
        }),
      }),
    );
    const uploadPayload = await uploadResponse.json();

    assert.equal(uploadResponse.status, 400);
    assert.equal(uploadPayload.code, "unsupported_file_type");

    const emptyFormData = new FormData();
    const generationResponse = await createFeed(
      new Request("http://localhost/api/study-feed", {
        method: "POST",
        body: emptyFormData,
        headers: requestHeaders,
      }),
    );
    const generationPayload = await generationResponse.json();

    assert.equal(generationResponse.status, 400);
    assert.match(generationPayload.error, /source material/i);
  } finally {
    await waitForScheduledDocumentJobs();
    resetRateLimitState();
    restoreEnv("ATTENTION_REGAIN_DATA_DIR", previousDataDir);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Day 14 release docs and UI define launch validation, rollback, and responsive access", async () => {
  const releaseDoc = await readFile(
    new URL("../docs/release-validation.md", import.meta.url),
    "utf8",
  );
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const workspace = await readFile(
    new URL("../src/components/study-workspace.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

  for (const expected of [
    "Release Checklist",
    "Rollback Procedure",
    "release-quality-gate",
    "AIAYN.pdf",
    "SAM.pdf",
    "OPUS.pdf",
    "merge-blocking",
  ]) {
    assert.match(releaseDoc + workflow, new RegExp(expected));
  }

  assert.match(workflow, /bash scripts\/check\.sh/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /maxLength=\{80000\}/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
  assert.doesNotMatch(css, /\dvw/);
});

async function waitForReadyWorkspace({ GET, requestHeaders }) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const workspace = await loadWorkspace({ GET, requestHeaders });
    if (workspace.deck && workspace.job?.status === "succeeded") {
      return workspace;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.fail("Timed out waiting for a release-validation workspace.");
}

async function loadWorkspace({ GET, requestHeaders }) {
  const response = await GET(
    new Request("http://localhost/api/study-feed", {
      method: "GET",
      headers: requestHeaders,
    }),
  );
  const workspace = await response.json();

  assert.equal(response.status, 200);
  return workspace;
}

function buildReleaseSourceText() {
  return [
    "Release validation starts with an authenticated reader uploading or pasting a study source.",
    "The parser must normalize readable text before the chunker creates source passages.",
    "Retrieval should select grounded passages before generation creates cards.",
    "Each card needs a citation and a source reference so review stays tied to the original material.",
    "A resumed session should restore the ready deck and any study actions recorded by the reader.",
    "Known failure paths should reject unsupported uploads and empty generation requests before worker execution.",
  ].join(" ");
}

function restoreEnv(key, value) {
  if (typeof value === "string") {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
