import { createHash } from "node:crypto";

import { safeObjectFileName } from "./validation.js";

export function createUploadObjectKey({ userId, documentId, fileName }) {
  const ownerSegment = createOwnerSegment(userId);
  return [
    "private",
    "users",
    ownerSegment,
    "documents",
    String(documentId || "").trim(),
    "source",
    safeObjectFileName(fileName),
  ].join("/");
}

export function createS3ObjectUri(bucket, key) {
  return `s3://${bucket}/${key}`;
}

function createOwnerSegment(userId) {
  return createHash("sha256")
    .update(String(userId || ""), "utf8")
    .digest("hex")
    .slice(0, 32);
}
