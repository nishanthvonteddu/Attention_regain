import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAuthenticatedProductSession,
  serializeProductSession,
} from "../src/lib/auth/session-shared.js";
import { createLocalJsonStore } from "../src/lib/data/local-store.js";
import { createStudyRepository } from "../src/lib/data/repositories.js";
import { createUploadObjectKey } from "../src/lib/uploads/object-keys.js";
import { createPrivateUploadHandshake } from "../src/lib/uploads/private-upload-service.js";
import { createPresignedPutObjectUrl } from "../src/lib/uploads/s3-presign.js";
import { validateUploadDescriptor } from "../src/lib/uploads/validation.js";

test("Day 04 documentation and migration define private upload traceability", async () => {
  const doc = await readFile(new URL("../docs/upload-pipeline.md", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../db/migrations/0002_document_uploads.sql", import.meta.url),
    "utf8",
  );

  for (const expected of [
    "POST /api/document-uploads",
    "private/users/<sha256-user-segment>/documents/<document-id>/source/<file-name>",
    "document_uploads",
    "owner-bound private object metadata",
  ]) {
    assert.match(doc, new RegExp(escapeRegExp(expected)));
  }

  assert.match(migration, /CREATE TABLE document_uploads/);
  assert.match(migration, /user_id TEXT NOT NULL REFERENCES users\(id\)/);
  assert.match(migration, /UNIQUE \(bucket, object_key\)/);
});

test("upload descriptors reject empty, oversized, and unsupported files", () => {
  assert.equal(validateUploadDescriptor({ fileName: "empty.pdf", sizeBytes: 0 }).ok, false);
  assert.equal(
    validateUploadDescriptor({
      fileName: "huge.pdf",
      contentType: "application/pdf",
      sizeBytes: 13 * 1024 * 1024,
    }).code,
    "file_too_large",
  );
  assert.equal(
    validateUploadDescriptor({
      fileName: "payload.exe",
      contentType: "application/octet-stream",
      sizeBytes: 100,
    }).code,
    "unsupported_file_type",
  );
  assert.equal(
    validateUploadDescriptor({
      fileName: "notes.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    }).descriptor.sourceKind,
    "pdf",
  );
});

test("object keys are deterministic and do not expose raw user ids", () => {
  const key = createUploadObjectKey({
    userId: "reader@example.com",
    documentId: "doc_123",
    fileName: "My Source.PDF",
  });

  assert.equal(
    key,
    createUploadObjectKey({
      userId: "reader@example.com",
      documentId: "doc_123",
      fileName: "My Source.PDF",
    }),
  );
  assert.match(key, /^private\/users\/[a-f0-9]{32}\/documents\/doc_123\/source\/my-source.pdf$/);
  assert.equal(key.includes("reader@example.com"), false);
});

test("private upload metadata binds S3 objects to the authenticated owner", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-upload-"));
  const repository = createStudyRepository({
    store: createLocalJsonStore({ dataDir }),
  });

  try {
    const handshake = await createPrivateUploadHandshake({
      user: { id: "owner-123", email: "owner@example.com" },
      title: "Private paper",
      goal: "study the upload",
      file: {
        fileName: "paper.pdf",
        contentType: "application/pdf",
        sizeBytes: 256,
      },
      env: { ENABLE_AWS_SERVICES: "false" },
      repository,
    });

    assert.equal(handshake.ok, true);
    assert.match(handshake.upload.objectUri, /^s3:\/\/local-private-documents\//);
    assert.equal(handshake.upload.uploadMode, "metadata-only");

    await repository.markDocumentUploadUploaded({
      userId: "owner-123",
      documentId: handshake.upload.documentId,
      etag: "etag-123",
    });
    const deck = await repository.saveGeneratedDeck({
      user: { id: "owner-123" },
      documentId: handshake.upload.documentId,
      documentTitle: "Private paper",
      goal: "study the upload",
      sourceKind: "pdf",
      sourceRef: handshake.upload.objectUri,
      passages: [
        {
          text: "Private uploads keep the source object tied to the owner record.",
          citation: "Page 1",
          topics: ["Privacy"],
        },
      ],
      focusTags: ["Privacy"],
      generationMode: "fallback",
      model: "heuristic-fallback",
      stats: { cardCount: 1, chunkCount: 1 },
      cards: [
        {
          kind: "glance",
          title: "Private upload boundary",
          body: "The source object is owner-bound.",
          excerpt: "Private uploads keep the source object tied to the owner record.",
          citation: "Page 1",
        },
      ],
    });
    const store = await createLocalJsonStore({ dataDir }).read();
    const upload = store.documentUploads.find(
      (entry) => entry.documentId === handshake.upload.documentId,
    );
    const document = store.documents.find((entry) => entry.id === deck.documentId);

    assert.equal(upload.status, "consumed");
    assert.equal(document.sourceRef, handshake.upload.objectUri);
    assert.equal(document.userId, "owner-123");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("presigned S3 uploads keep signing secrets server-side", () => {
  const presigned = createPresignedPutObjectUrl({
    bucket: "attention-private",
    key: "private/users/user/documents/doc/source/file.pdf",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "do-not-return-this-secret",
    contentType: "application/pdf",
    now: new Date("2026-04-21T12:00:00.000Z"),
  });

  assert.match(presigned.url, /^https:\/\/attention-private\.s3\.us-east-1\.amazonaws\.com\//);
  assert.match(presigned.url, /X-Amz-Signature=/);
  assert.equal(presigned.url.includes("do-not-return-this-secret"), false);
  assert.equal(presigned.requiredHeaders["x-amz-server-side-encryption"], "AES256");
});

test("document upload route rejects invalid and cross-origin upload attempts", async () => {
  const previousDataDir = process.env.ATTENTION_REGAIN_DATA_DIR;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attention-regain-upload-route-"));
  process.env.ATTENTION_REGAIN_DATA_DIR = dataDir;

  try {
    const { POST } = await import("../src/app/api/document-uploads/route.js");
    const sessionCookie = serializeProductSession(
      createAuthenticatedProductSession({
        userId: "route-owner",
        email: "route@example.com",
        displayName: "Route Owner",
        source: "test",
      }),
    );

    const invalid = await POST(
      new Request("http://localhost/api/document-uploads", {
        method: "POST",
        body: JSON.stringify({
          fileName: "bad.exe",
          contentType: "application/octet-stream",
          sizeBytes: 10,
        }),
        headers: {
          "content-type": "application/json",
          cookie: `attention_regain_session=${sessionCookie}`,
        },
      }),
    );
    const crossOrigin = await POST(
      new Request("http://localhost/api/document-uploads", {
        method: "POST",
        body: JSON.stringify({
          fileName: "paper.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
        }),
        headers: {
          "content-type": "application/json",
          cookie: `attention_regain_session=${sessionCookie}`,
          origin: "https://attacker.example",
        },
      }),
    );

    assert.equal(invalid.status, 400);
    assert.equal(crossOrigin.status, 403);
  } finally {
    if (typeof previousDataDir === "string") {
      process.env.ATTENTION_REGAIN_DATA_DIR = previousDataDir;
    } else {
      delete process.env.ATTENTION_REGAIN_DATA_DIR;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
