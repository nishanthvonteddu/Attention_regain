import {
  readProductSessionFromCookieHeader,
  requestHasAuthenticatedSession,
} from "../../../lib/auth/session.server.js";
import { requestHasSameOrigin } from "../../../lib/auth/request.js";
import { getDefaultStudyRepository } from "../../../lib/data/repositories.js";
import { createPrivateUploadHandshake } from "../../../lib/uploads/private-upload-service.js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before preparing a private document upload." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json({ error: "Document upload writes must be same-origin." }, { status: 403 });
    }

    const payload = await request.json();
    const handshake = await createPrivateUploadHandshake({
      user: session.user,
      title: String(payload.title || ""),
      goal: String(payload.goal || ""),
      file: {
        fileName: payload.fileName,
        contentType: payload.contentType,
        sizeBytes: payload.sizeBytes,
      },
    });

    if (!handshake.ok) {
      return Response.json(
        {
          error: handshake.error,
          code: handshake.code,
          uploadStatus: "rejected",
        },
        { status: 400 },
      );
    }

    return Response.json({ upload: handshake.upload }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare the private upload.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before confirming a private document upload." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json({ error: "Document upload writes must be same-origin." }, { status: 403 });
    }

    const payload = await request.json();
    const upload = await getDefaultStudyRepository().markDocumentUploadUploaded({
      userId: session.user.id,
      documentId: String(payload.documentId || ""),
      etag: typeof payload.etag === "string" ? payload.etag : "",
    });

    return Response.json({
      upload: {
        id: upload.id,
        documentId: upload.documentId,
        status: upload.status,
        objectUri: upload.objectUri,
        uploadedAt: upload.uploadedAt,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not confirm the private upload.",
      },
      { status: 400 },
    );
  }
}
