import { getDefaultStudyRepository } from "../data/repositories.js";
import { runDocumentPipeline } from "../study/pipeline.js";

const SCHEDULED_JOBS = new Set();

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
  const timer = setTimeout(async () => {
    SCHEDULED_JOBS.delete(jobId);
    await processDocumentProcessingJob({ jobId, repository, env });
  }, delayMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return true;
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

    await repository.completeDocumentProcessingJob({
      jobId: job.id,
      resultStatus: result.documentStatus || result.stats?.parseStatus || "cards_generated",
    });
    return result;
  } catch (error) {
    const failedJob = await repository.failDocumentProcessingJob({
      jobId: job.id,
      errorMessage:
        error instanceof Error ? error.message : "Document processing failed unexpectedly.",
    });

    if (failedJob?.status === "retrying") {
      scheduleDocumentProcessingJob({
        jobId: failedJob.id,
        repository,
        env,
        delayMs: failedJob.retryDelayMs || 250,
      });
    }

    return failedJob;
  }
}
