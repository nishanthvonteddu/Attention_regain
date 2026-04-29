import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import nextConfig from "../next.config.js";
import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";
import {
  checkRateLimit,
  resetRateLimitState,
} from "../src/lib/security/rate-limit.js";
import { createPrivateUploadHandshake } from "../src/lib/uploads/private-upload-service.js";

test("Day 12 docs define launch privacy, ownership, headers, and abuse controls", async () => {
  const doc = await readFile(new URL("../docs/security-privacy.md", import.meta.url), "utf8");

  for (const expected of [
    "Document Ownership",
    "Private Upload Storage",
    "Security Headers",
    "Rate Limits",
    "Launch Checklist",
    "Cross-user document access",
  ]) {
    assert.match(doc, new RegExp(expected));
  }
});

test("document upload ownership is enforced for reads and confirmations", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-security-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const handshake = await createPrivateUploadHandshake({
      user: { id: "owner-user", email: "owner@example.com" },
      title: "Owner source",
      file: {
        fileName: "owner.pdf",
        contentType: "application/pdf",
        sizeBytes: 512,
      },
      env: { ENABLE_AWS_SERVICES: "false" },
      repository,
    });

    assert.equal(handshake.ok, true);
    assert.equal(
      await repository.getDocumentUploadForUser("other-user", handshake.upload.documentId),
      null,
    );
    await assert.rejects(
      () => repository.markDocumentUploadUploaded({
        userId: "other-user",
        documentId: handshake.upload.documentId,
        etag: "wrong-owner",
      }),
      /not found for this user/i,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("private uploads must be completed before study-feed processing starts", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-upload-status-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;
  resetRateLimitState();

  try {
    const { POST: prepareUpload } = await import("../src/app/api/document-uploads/route.js");
    const { POST: createFeed } = await import("../src/app/api/study-feed/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "status-owner",
        email: "status@example.com",
        displayName: "Status Owner",
        source: "test",
      }),
    );

    const uploadResponse = await prepareUpload(
      new Request("http://localhost/api/document-uploads", {
        method: "POST",
        body: JSON.stringify({
          fileName: "source.pdf",
          contentType: "application/pdf",
          sizeBytes: 512,
        }),
        headers: {
          "content-type": "application/json",
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const uploadPayload = await uploadResponse.json();
    const formData = new FormData();
    formData.set("uploadDocumentId", uploadPayload.upload.documentId);
    formData.set(
      "file",
      new File(["Private source text"], "source.pdf", { type: "application/pdf" }),
    );

    const feedResponse = await createFeed(
      new Request("http://localhost/api/study-feed", {
        method: "POST",
        body: formData,
        headers: {
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );

    assert.equal(feedResponse.status, 409);
    assert.match((await feedResponse.json()).error, /must finish/i);
  } finally {
    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    resetRateLimitState();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("critical endpoint rate limits bound repeated abuse", () => {
  resetRateLimitState();
  const request = new Request("http://localhost/api/study-feed", {
    headers: { "x-forwarded-for": "203.0.113.8" },
  });
  const limits = { generation: { limit: 2, windowMs: 60_000 } };

  assert.equal(checkRateLimit({ request, scope: "generation", limits }).allowed, true);
  assert.equal(checkRateLimit({ request, scope: "generation", limits }).allowed, true);
  const blocked = checkRateLimit({ request, scope: "generation", limits });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  resetRateLimitState();
});

test("Next.js config applies baseline browser security headers", async () => {
  const rules = await nextConfig.headers();
  const headers = Object.fromEntries(
    rules.flatMap((rule) => rule.headers.map((header) => [header.key, header.value])),
  );

  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
});
