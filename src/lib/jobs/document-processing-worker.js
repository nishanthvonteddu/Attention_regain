import { getDefaultStudyRepository } from "../data/repositories.js";
import { runDocumentPipeline } from "../study/pipeline.js";

const SCHEDULED_JOBS = new Set();
const SCHEDULED_JOB_PROMISES = new Map();
const SCHEDULED_JOB_TIMERS = new Map();

export function scheduleDocumentProcessingJob({
  jobId,
  repository = getDefaultStudyRepository(),
  env = process.env,
  delayMs = 25,
} = {}) {
  if (!jobId || SCHEDULED_JOBS.has(jobId)) {
    return false;
  }

  SCHEDULED_JOBS.add(jobId);
  let timer;
  const scheduledJob = new Promise((resolve) => {
    timer = setTimeout(async () => {
      try {
        await processDocumentProcessingJob({ jobId, repository, env });
      } finally {
        SCHEDULED_JOBS.delete(jobId);
        SCHEDULED_JOB_PROMISES.delete(jobId);
        SCHEDULED_JOB_TIMERS.delete(jobId);
        resolve();
      }
    }, delayMs);
  });
  SCHEDULED_JOB_PROMISES.set(jobId, scheduledJob);
  SCHEDULED_JOB_TIMERS.set(jobId, timer);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return true;
}

export async function waitForScheduledDocumentJobs() {
  while (SCHEDULED_JOB_PROMISES.size) {
    for (const timer of SCHEDULED_JOB_TIMERS.values()) {
      if (typeof timer.ref === "function") {
        timer.ref();
      }
    }
    await Promise.all([...SCHEDULED_JOB_PROMISES.values()]);
  }
}

export async function processDocumentProcessingJob({
  jobId,
  repository = getDefaultStudyRepository(),
  env = process.env,
} = {}) {
  const workerId = `worker-${process.pid}-${Date.now()}`;
  const job = await repository.claimDocumentProcessingJob({ jobId, workerId });
  if (!job) {
    return null;
  }
  await recordWorkerEvent(repository, {
    eventName: "job.claimed",
    stage: "worker",
    status: "started",
    userId: job.userId,
    documentId: job.documentId,
    jobId: job.id,
    payload: { attemptCount: job.attemptCount, workerId },
  });

  try {
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const result = await runDocumentPipeline({
      documentId: job.documentId,
      title: payload.title,
      goal: payload.goal,
      source: payload.source,
      user: { id: job.userId },
      repository,
      env,
    });

    const completedAt = Date.now();
    await repository.completeDocumentProcessingJob({
      jobId: job.id,
      resultStatus: result.documentStatus || result.stats?.parseStatus || "cards_generated",
    });
    if (result.id || result.sessionId || result.documentStatus === "cards_generated") {
      await recordWorkerEvent(repository, {
        eventName: "feed.ready",
        stage: "feed",
        status: "succeeded",
        userId: job.userId,
        documentId: job.documentId,
        sessionId: result.sessionId,
        jobId: job.id,
        latencyMs: completedAt - Date.parse(job.createdAt),
        cost: result.stats?.modelCost,
        payload: {
          resultStatus: result.documentStatus || result.stats?.parseStatus || "cards_generated",
          generationMode: result.generationMode,
          model: result.model,
        },
      });
    }
    return result;
  } catch (error) {
    const failedJob = await repository.failDocumentProcessingJob({
      jobId: job.id,
      errorMessage:
        error instanceof Error ? error.message : "Document processing failed unexpectedly.",
    });

    if (failedJob?.status === "retrying") {
      await recordWorkerEvent(repository, {
        eventName: "job.retrying",
        stage: "worker",
        status: "retrying",
        userId: failedJob.userId,
        documentId: failedJob.documentId,
        jobId: failedJob.id,
        payload: { reason: failedJob.lastError, attemptCount: failedJob.attemptCount },
      });
      scheduleDocumentProcessingJob({
        jobId: failedJob.id,
        repository,
        env,
        delayMs: failedJob.retryDelayMs || 250,
      });
    } else if (failedJob?.status === "dead_letter") {
      await recordWorkerEvent(repository, {
        eventName: "job.dead_lettered",
        stage: "worker",
        status: "failed",
        userId: failedJob.userId,
        documentId: failedJob.documentId,
        jobId: failedJob.id,
        payload: { reason: failedJob.lastError, attemptCount: failedJob.attemptCount },
      });
    }

    return failedJob;
  }
}

async function recordWorkerEvent(repository, input) {
  if (typeof repository?.recordProductEvent !== "function") {
    return null;
  }

  try {
    return await repository.recordProductEvent(input);
  } catch {
    return null;
  }
}
