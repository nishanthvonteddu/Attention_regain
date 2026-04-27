import {
  readProductSessionFromCookieHeader,
  requestHasAuthenticatedSession,
} from "../../../lib/auth/session.server.js";
import { requestHasSameOrigin } from "../../../lib/auth/request.js";
import { getDefaultStudyRepository } from "../../../lib/data/repositories.js";
import {
  createDocumentProcessingPayload,
  createDocumentProcessingSource,
  DOCUMENT_PROCESSING_MAX_ATTEMPTS,
  DOCUMENT_PROCESSING_QUEUE,
} from "../../../lib/jobs/document-processing.js";
import { scheduleDocumentProcessingJob } from "../../../lib/jobs/document-processing-worker.js";

export const runtime = "nodejs";

const DEFAULT_GOAL = "stay close to the material when attention slips";

export async function POST(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    const repository = getDefaultStudyRepository();
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before generating a private study feed." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json({ error: "Study feed writes must be same-origin." }, { status: 403 });
    }

    const formData = await request.formData();
    const title = String(formData.get("title") || "").trim();
    const goal = String(formData.get("goal") || "").trim() || DEFAULT_GOAL;
    const sourceText = String(formData.get("sourceText") || "");
    const uploaded = formData.get("file");
    const uploadDocumentId = String(formData.get("uploadDocumentId") || "").trim();
    const retryDocumentId = String(formData.get("retryDocumentId") || "").trim();

    if (retryDocumentId) {
      const retryJob = await repository.getLatestDocumentProcessingJobForUser(
        session.user.id,
        retryDocumentId,
      );
      if (!retryJob) {
        return Response.json(
          { error: "No prior processing job was found for this document." },
          { status: 404 },
        );
      }
      const retryJobIsActive =
        retryJob.status === "queued" ||
        retryJob.status === "processing" ||
        retryJob.status === "retrying";
      if (retryJobIsActive) {
        return Response.json(
          { error: "This document already has active processing in progress." },
          { status: 409 },
        );
      }

      const job = await repository.enqueueDocumentProcessingJob({
        userId: session.user.id,
        documentId: retryDocumentId,
        queueName: DOCUMENT_PROCESSING_QUEUE,
        maxAttempts: DOCUMENT_PROCESSING_MAX_ATTEMPTS,
        payload: retryJob.payload,
      });

      scheduleDocumentProcessingJob({ jobId: job.id, repository });

      return Response.json(
        {
          accepted: true,
          retried: true,
          ...(await repository.getLatestWorkspaceForUser(session.user.id)),
        },
        { status: 202 },
      );
    }

    if (!(uploaded instanceof File) && !sourceText.trim()) {
      return Response.json(
        { error: "Add some source material first. Paste text or upload a PDF." },
        { status: 400 },
      );
    }

    if (uploadDocumentId) {
      const upload = await repository.getDocumentUploadForUser(session.user.id, uploadDocumentId);
      if (!upload) {
        return Response.json(
          { error: "The upload record was not found for this user." },
          { status: 400 },
        );
      }
    }

    const source = await createDocumentProcessingSource({
      sourceText,
      file: uploaded instanceof File ? uploaded : null,
    });
    const document = uploadDocumentId
      ? { id: uploadDocumentId }
      : await repository.createDocumentRecord({
          user: session.user,
          title: resolveDocumentTitle({ title, source }),
          goal,
          sourceKind: source.sourceKind,
          sourceRef: buildSourceReference(source),
        });
    const job = await repository.enqueueDocumentProcessingJob({
      userId: session.user.id,
      documentId: document.id,
      queueName: DOCUMENT_PROCESSING_QUEUE,
      maxAttempts: DOCUMENT_PROCESSING_MAX_ATTEMPTS,
      payload: createDocumentProcessingPayload({
        documentId: document.id,
        title: resolveDocumentTitle({ title, source }),
        goal,
        source,
      }),
    });

    scheduleDocumentProcessingJob({ jobId: job.id, repository });

    return Response.json(
      {
        accepted: true,
        ...(await repository.getLatestWorkspaceForUser(session.user.id)),
      },
      { status: 202 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not turn the source into a study feed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before loading a private study feed." },
        { status: 401 },
      );
    }

    const repository = getDefaultStudyRepository();
    const workspace = await repository.getLatestWorkspaceForUser(session.user.id);
    if (workspace.job?.active) {
      scheduleDocumentProcessingJob({ jobId: workspace.job.id, repository });
    }

    return Response.json(workspace);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load the persisted study feed.",
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
        { error: "Sign in before saving study interactions." },
        { status: 401 },
      );
    }
    if (!requestHasSameOrigin(request)) {
      return Response.json(
        { error: "Study interaction writes must be same-origin." },
        { status: 403 },
      );
    }

    const payload = await request.json();
    const interaction = await getDefaultStudyRepository().recordInteraction({
      userId: session.user.id,
      sessionId: String(payload.sessionId || ""),
      cardId: String(payload.cardId || ""),
      interactionType: String(payload.interactionType || ""),
      value:
        payload.value == null
          ? ""
          : typeof payload.value === "string"
            ? payload.value
            : JSON.stringify(payload.value),
    });

    return Response.json({ interaction });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save the study interaction.",
      },
      { status: 400 },
    );
  }
}

function resolveDocumentTitle({ title, source }) {
  if (title) {
    return title;
  }

  if (source?.type === "inline_file") {
    return String(source.fileName || "Untitled source").replace(/\.[^.]+$/, "");
  }

  return "Untitled study source";
}

function buildSourceReference(source) {
  if (source?.type === "inline_file") {
    return String(source.fileName || "");
  }

  return "inline://pasted-source";
}
