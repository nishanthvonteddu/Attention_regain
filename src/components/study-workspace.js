"use client";

import Link from "next/link";
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";

import { useAuthShell } from "./auth-shell-provider.js";
import { PREVIEW_DECK, SAMPLE_SOURCE } from "../lib/study-preview.js";
import { MAX_UPLOAD_BYTES, validateUploadDescriptor } from "../lib/uploads/validation.js";

const STORAGE_KEY_PREFIX = "attention-regain-draft-v4";

const EMPTY_FEEDBACK = {
  confidence: null,
  saved: false,
  revealed: false,
};

const TONE = {
  glance: {
    label: "Quick read",
    style: { backgroundColor: "rgba(217, 108, 63, 0.12)", color: "#b5552e" },
    promptLabel: "Source anchor",
  },
  recall: {
    label: "Active recall",
    style: { backgroundColor: "rgba(41, 88, 70, 0.12)", color: "#295846" },
    promptLabel: "Recall prompt",
  },
  application: {
    label: "Use it",
    style: { backgroundColor: "rgba(145, 93, 10, 0.12)", color: "#7b5008" },
    promptLabel: "Transfer prompt",
  },
  pitfall: {
    label: "Trap door",
    style: { backgroundColor: "rgba(120, 67, 58, 0.12)", color: "#74433a" },
    promptLabel: "What to avoid",
  },
};

export function StudyWorkspace() {
  const { auth, session, shell } = useAuthShell();
  const storageKey = `${STORAGE_KEY_PREFIX}:${session.user.id}`;
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const [workspaceState, setWorkspaceState] = useState(null);
  const [deck, setDeck] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "The private workspace is ready. Upload a paper or paste notes to turn this session into a grounded study feed.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deferredDeck = useDeferredValue(deck);
  const visibleDeck = deferredDeck || deck || (!workspaceState?.document ? PREVIEW_DECK : null);
  const isPreview = !deck && !workspaceState?.document;
  const identityLabel =
    session.user.displayName || session.user.email || session.user.id;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved);
      setTitle(parsed.title || "");
      setGoal(parsed.goal || "");
      setSourceText(parsed.sourceText || "");
      setFileName(parsed.fileName || "");
      setUploadStatus(parsed.uploadStatus || null);
    } catch {
      window.localStorage.removeItem(storageKey);
    } finally {
      setHasLoadedDraft(true);
    }
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadServerSession() {
      try {
        const response = await fetch("/api/study-feed", { method: "GET" });
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (cancelled || (!payload.deck && !payload.document)) {
          return;
        }

        startTransition(() => {
          setDeck(payload.deck || null);
          setWorkspaceState(payload);
          if (payload.deck) {
            setFeedback(payload.deck.feedback || {});
          }
        });
        setTitle(payload.deck?.documentTitle || payload.document?.title || "");
        setGoal(payload.deck?.goal || payload.document?.goal || "");
        setStatusMessage(describeWorkspaceStatus(payload));
      } catch {
        // Browser storage remains a local fallback if the server adapter is unavailable.
      }
    }

    loadServerSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistDraft = useEffectEvent(() => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        title,
        goal,
        sourceText,
        fileName,
        uploadStatus,
      }),
    );
  });

  useEffect(() => {
    if (!hasLoadedDraft) {
      return;
    }
    persistDraft();
  }, [
    fileName,
    goal,
    hasLoadedDraft,
    persistDraft,
    sourceText,
    storageKey,
    title,
    uploadStatus,
  ]);

  const syncWorkspace = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/study-feed", { method: "GET" });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      startTransition(() => {
        setWorkspaceState(payload);
        setDeck(payload.deck || null);
        if (payload.deck) {
          setFeedback(payload.deck.feedback || {});
        }
      });
      setStatusMessage(describeWorkspaceStatus(payload));
    } catch {
      // The last visible status stays in place until polling succeeds again.
    }
  });

  useEffect(() => {
    if (!workspaceState?.job?.active) {
      return;
    }

    void syncWorkspace();
    const timer = window.setInterval(() => {
      void syncWorkspace();
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [syncWorkspace, workspaceState?.job?.active]);

  const feedbackValues = Object.values(feedback);
  const sessionStats = {
    locked: feedbackValues.filter((entry) => entry.confidence === "locked").length,
    review: feedbackValues.filter((entry) => entry.confidence === "review").length,
    saved: feedbackValues.filter((entry) => entry.saved).length,
    revealed: feedbackValues.filter((entry) => entry.revealed).length,
  };

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    if (!sourceText.trim() && !file) {
      setError("Add some source material first. Paste text or upload a PDF.");
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage(
        file
          ? "Preparing a private upload record before queueing background processing."
          : "Queueing the source for background parsing and grounded card generation.",
      );

      const upload = file ? await preparePrivateUpload(file) : null;

      const formData = new FormData();
      formData.set("title", title);
      formData.set("goal", goal);
      formData.set("sourceText", sourceText);
      if (upload?.documentId) {
        formData.set("uploadDocumentId", upload.documentId);
      }
      if (file) {
        formData.set("file", file);
      }

      const response = await fetch("/api/study-feed", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Could not build the study feed.");
      }

      startTransition(() => {
        setWorkspaceState(payload);
        setDeck(payload.deck || null);
        if (payload.deck) {
          setFeedback(payload.deck.feedback || {});
        }
      });
      setUploadStatus(buildProcessingBadge(payload));
      setStatusMessage(describeWorkspaceStatus(payload));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not build the study feed.",
      );
      setStatusMessage("The source needs a cleaner input before it can become a feed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetryProcessing() {
    if (!workspaceState?.document?.id) {
      return;
    }

    setError("");
    setIsSubmitting(true);
    setStatusMessage("Retrying background generation for the active document.");

    try {
      const formData = new FormData();
      formData.set("retryDocumentId", workspaceState.document.id);
      const response = await fetch("/api/study-feed", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Could not retry background generation.");
      }

      startTransition(() => {
        setWorkspaceState(payload);
        setDeck(payload.deck || null);
        if (payload.deck) {
          setFeedback(payload.deck.feedback || {});
        }
      });
      setUploadStatus(buildProcessingBadge(payload));
      setStatusMessage(describeWorkspaceStatus(payload));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not retry background generation.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function applySample() {
    setTitle(SAMPLE_SOURCE.title);
    setGoal(SAMPLE_SOURCE.goal);
    setSourceText(SAMPLE_SOURCE.body);
    setFile(null);
    setFileName("");
    setUploadStatus(null);
    setWorkspaceState(null);
    setError("");
    setStatusMessage(
      "Sample reading loaded. Generate the feed to inspect the full protected-session workflow.",
    );
  }

  function resetSession() {
    setTitle("");
    setGoal("");
    setSourceText("");
    setFile(null);
    setFileName("");
    setUploadStatus(null);
    setWorkspaceState(null);
    setDeck(null);
    setFeedback({});
    setError("");
    setStatusMessage(
      "Private session cleared. Add a paper, notes, or interview reading packet to rebuild the feed.",
    );
    window.localStorage.removeItem(storageKey);
  }

  function onFileChange(nextFile) {
    setError("");
    setUploadStatus(null);
    setWorkspaceState(null);

    if (!nextFile) {
      setFile(null);
      setFileName("");
      return;
    }

    const validation = validateUploadDescriptor({
      fileName: nextFile.name,
      contentType: nextFile.type,
      sizeBytes: nextFile.size,
    });
    if (!validation.ok) {
      setFile(null);
      setFileName("");
      setError(validation.message);
      setStatusMessage("The selected file was rejected before upload.");
      return;
    }

    setFile(nextFile);
    setFileName(validation.descriptor.fileName);
    setError("");
    setUploadStatus({
      label: "Ready for private upload",
      detail: `${Math.ceil(validation.descriptor.sizeBytes / 1024)} KB, ${validation.descriptor.contentType}`,
    });

    setSourceText("");
    if (!title.trim()) {
      setTitle(validation.descriptor.fileName.replace(/\.[^.]+$/, ""));
    }
    setStatusMessage(`${validation.descriptor.fileName} attached. Generate the feed when ready.`);
  }

  async function preparePrivateUpload(nextFile) {
    setUploadStatus({
      label: "Preparing upload",
      detail: "Creating an owner-bound private object key.",
    });

    const response = await fetch("/api/document-uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        goal,
        fileName: nextFile.name,
        contentType: nextFile.type,
        sizeBytes: nextFile.size,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not prepare the private upload.");
    }

    const upload = payload.upload;
    if (upload.url) {
      setUploadStatus({
        label: "Uploading privately",
        detail: "Sending the file to the owner-bound S3 object.",
      });
      const uploadResponse = await fetch(upload.url, {
        method: "PUT",
        headers: upload.requiredHeaders || {},
        body: nextFile,
      });
      if (!uploadResponse.ok) {
        throw new Error("S3 rejected the private upload.");
      }
    }

    const confirmResponse = await fetch("/api/document-uploads", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentId: upload.documentId,
      }),
    });
    const confirmed = await confirmResponse.json();
    if (!confirmResponse.ok) {
      throw new Error(confirmed.error || "Could not confirm the private upload.");
    }

    setUploadStatus({
      label: "Upload metadata saved",
      detail: upload.objectKey,
    });
    setStatusMessage(
      upload.url
        ? "Private S3 upload confirmed. The source is ready for the background worker."
        : "Private upload metadata saved. The source is ready for the background worker.",
    );

    return upload;
  }

  function toggleReveal(cardId) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        revealed: !(current[cardId]?.revealed || false),
      },
    }));
    persistInteraction(cardId, "reveal_answer", "true");
  }

  function toggleSave(cardId) {
    const nextSaved = !(feedback[cardId]?.saved || false);
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        saved: nextSaved,
      },
    }));
    persistInteraction(cardId, nextSaved ? "save_card" : "unsave_card", String(nextSaved));
  }

  function setConfidence(cardId, confidence) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        confidence,
      },
    }));
    persistInteraction(cardId, "set_confidence", confidence);
  }

  async function persistInteraction(cardId, interactionType, value) {
    if (!deck?.sessionId) {
      return;
    }

    try {
      await fetch("/api/study-feed", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: deck.sessionId,
          cardId,
          interactionType,
          value,
        }),
      });
    } catch {
      // The immediate UI state is optimistic; failed writes can be retried in a later sync pass.
    }
  }

  const busy = isSubmitting || isPending;
  const visibleUploadStatus = buildProcessingBadge(workspaceState) || uploadStatus;
  const workspaceView = resolveWorkspaceView(workspaceState, Boolean(visibleDeck && !isPreview));

  return (
    <main className="shell">
      <section className="panel">
        <div className="panel-inner">
          <div className="panel-glow" />
          <div className="shell-toolbar">
            <div className="toolbar-copy">
              <p className="eyebrow">Private Study Workspace</p>
              <strong>{identityLabel}</strong>
              <span>{shell.description}</span>
            </div>
            <div className="toolbar-actions">
              <Link className="secondary-button" href="/">
                Public preview
              </Link>
              <form action={auth.routes.signOutPath} method="post">
                <button className="ghost-button" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <h1 className="hero">Turn distraction into a private study loop.</h1>
          <p className="lede">
            This route is protected by a server-issued session cookie. The product
            still uses local persistence for the single-user MVP, but the workspace
            now lives behind an authenticated shell instead of anonymous browser entry.
          </p>

          <div className="status">
            <p className="eyebrow">Session status</p>
            <p>{statusMessage}</p>
            {error ? <div className="error">{error}</div> : null}
            {workspaceState?.resume?.available ? (
              <div className={`resume-notice ${workspaceView.kind}`}>
                <strong>{workspaceState.resume.label}</strong>
                <span>
                  {workspaceState.resume.documentTitle}
                  {workspaceState.resume.lastActiveAt
                    ? ` | ${formatResumeTime(workspaceState.resume.lastActiveAt)}`
                    : ""}
                </span>
                <p>{workspaceState.resume.detail}</p>
              </div>
            ) : null}
            <p className="field-label" style={{ marginTop: 18 }}>
              Auth boundary
            </p>
            <p>
              <strong>{shell.label}.</strong> {shell.description}
            </p>
            {auth.warnings[0] ? <p>{auth.warnings[0]}</p> : null}
          </div>

          <form className="form-grid" onSubmit={handleGenerate}>
            <label className="field">
              <span className="field-label">Document title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Paper title, exam notes, interview packet"
              />
            </label>

            <label className="field">
              <span className="field-label">Study goal</span>
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Prepare for interviews, revise for an exam, explain a paper"
              />
            </label>

            <label className="field">
              <div className="field-meta">
                <span className="field-label">Source text</span>
                <span className="field-label">{sourceText.length}/80000</span>
              </div>
              <textarea
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="Paste study material here, or leave this empty and upload a PDF below."
              />
              <p className="helper">
                Paste text for the fastest loop, or upload a PDF/TXT file below.
              </p>
            </label>

            <div className="field">
              <span className="field-label">Upload file</span>
              <label className="dropzone">
                <strong>Drop a PDF or text file here</strong>
                <span>
                  Good for papers, chapters, and typed notes up to {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.
                  Uploads use owner-bound private object metadata before parsing.
                </span>
                <span className="chip-button">Choose file</span>
                <input
                  hidden
                  type="file"
                  accept=".pdf,.txt,.md,.text"
                  onChange={(event) => onFileChange(event.target.files?.[0] || null)}
                />
              </label>
              {fileName ? (
                <div className="file-pill">
                  <span>{fileName}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onFileChange(null)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
              {visibleUploadStatus ? (
                <div className="upload-status">
                  <strong>{visibleUploadStatus.label}</strong>
                  <span>{visibleUploadStatus.detail}</span>
                </div>
              ) : null}
            </div>

            <div className="actions">
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Building feed..." : "Generate grounded feed"}
              </button>
              <button className="secondary-button" type="button" onClick={applySample}>
                Load sample source
              </button>
              <button className="ghost-button" type="button" onClick={resetSession}>
                Reset session
              </button>
            </div>
          </form>

          <div className="rules">
            <div className="rule-row">
              <span>Protected route</span>
              <em>Required</em>
            </div>
            <div className="rule-row">
              <span>Grounded cards with citations</span>
              <em>Required</em>
            </div>
            <div className="rule-row">
              <span>Private upload validation</span>
              <em>PDF/TXT only</em>
            </div>
            <div className="rule-row">
              <span>Object ownership</span>
              <em>Account-bound</em>
            </div>
            <div className="rule-row">
              <span>Auth shell boundary</span>
              <em>{shell.authLabel}</em>
            </div>
            <div className="rule-row">
              <span>Session persistence boundary</span>
              <em>{shell.persistenceLabel}</em>
            </div>
          </div>
        </div>
      </section>

      <section className="feed-shell">
        <div className="feed-frame">
          {visibleDeck ? (
            <>
              <header className="feed-header">
                <p className="feed-mode">{isPreview ? "Protected preview" : "Private study session"}</p>
                <div className="feed-summary">
                  <div>
                    <h2 className="feed-title">{visibleDeck.documentTitle}</h2>
                    <p className="feed-goal">{visibleDeck.goal}</p>
                  </div>
                  <div>
                    <p className="feed-goal">
                      {visibleDeck.stats.estimatedMinutes} min source
                    </p>
                    <p>
                      {visibleDeck.stats.cardCount} cards from {visibleDeck.stats.chunkCount} passages
                    </p>
                    {visibleDeck.model ? (
                      <p style={{ marginTop: 8 }}>
                        {visibleDeck.generationMode === "ai"
                          ? `Model: ${visibleDeck.model}`
                          : visibleDeck.generationMode === "fallback"
                            ? "Mode: heuristic fallback"
                            : "Mode: preview"}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="tag-row">
                  {visibleDeck.focusTags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="metric-row">
                  <Metric label="Locked in" value={sessionStats.locked} />
                  <Metric label="Review again" value={sessionStats.review} />
                  <Metric label="Saved" value={sessionStats.saved} />
                  <Metric label="Revealed" value={sessionStats.revealed} />
                </div>
                {!isPreview ? <DocumentStatusStrip workspaceState={workspaceState} /> : null}
              </header>

              <div className="feed-body">
                <div className="feed-column">
                  {visibleDeck.cards.map((card) => {
                    const tone = TONE[card.kind] || TONE.glance;
                    const state = feedback[card.id] || EMPTY_FEEDBACK;

                    return (
                      <article className="feed-card" key={card.id}>
                        <div className="feed-card-head">
                          <div>
                            <span className="tone" style={tone.style}>
                              {tone.label}
                            </span>
                            <h3>{card.title}</h3>
                          </div>
                          <button
                            className={`pill ${state.saved ? "active-dark" : ""}`}
                            type="button"
                            onClick={() => toggleSave(card.id)}
                          >
                            {state.saved ? "Saved" : "Save"}
                          </button>
                        </div>

                        <p>{card.body}</p>

                        <div className="card-prompt">
                          <strong>{card.question ? tone.promptLabel : "Source anchor"}</strong>
                          <p>{card.question || card.excerpt}</p>

                          {card.answer ? (
                            <>
                              <button
                                className="primary-button"
                                style={{ marginTop: 14 }}
                                type="button"
                                onClick={() => toggleReveal(card.id)}
                              >
                                {state.revealed ? "Hide answer" : "Reveal answer"}
                              </button>
                              {state.revealed ? <div className="answer">{card.answer}</div> : null}
                            </>
                          ) : null}
                        </div>

                        <div className="card-actions">
                          <button
                            className={`pill ${state.confidence === "locked" ? "active-green" : ""}`}
                            type="button"
                            onClick={() =>
                              setConfidence(
                                card.id,
                                state.confidence === "locked" ? null : "locked",
                              )
                            }
                          >
                            Locked in
                          </button>
                          <button
                            className={`pill ${state.confidence === "review" ? "active-amber" : ""}`}
                            type="button"
                            onClick={() =>
                              setConfidence(
                                card.id,
                                state.confidence === "review" ? null : "review",
                              )
                            }
                          >
                            Review again
                          </button>
                          <span className="citation">{card.citation}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <DocumentStatePanel
              busy={busy}
              onRetry={handleRetryProcessing}
              workspaceState={workspaceState}
              workspaceView={workspaceView}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <label>{label}</label>
      <strong>{value}</strong>
    </div>
  );
}

function DocumentStatusStrip({ workspaceState }) {
  const view = resolveWorkspaceView(workspaceState, Boolean(workspaceState?.deck));

  return (
    <div className={`document-strip ${view.kind}`}>
      <div>
        <strong>{view.label}</strong>
        <span>{view.detail}</span>
      </div>
      <em>{formatDocumentStatus(workspaceState?.document?.status || "cards_generated")}</em>
    </div>
  );
}

function DocumentStatePanel({ busy, onRetry, workspaceState, workspaceView }) {
  const document = workspaceState?.document;
  const job = workspaceState?.job;

  return (
    <div className="feed-body">
      <div className="feed-column">
        <article className={`state-panel ${workspaceView.kind}`}>
          <div className="state-panel-head">
            <span className="tone" style={workspaceView.tone}>
              {workspaceView.badge}
            </span>
            <h3>{document?.title || "Waiting for a study source"}</h3>
            <p>{workspaceView.detail}</p>
          </div>

          <div className="state-grid">
            <Metric label="Document" value={formatDocumentStatus(document?.status || "None")} />
            <Metric label="Worker" value={formatDocumentStatus(job?.status || "Idle")} />
            <Metric label="Attempts" value={job ? `${job.attemptCount}/${job.maxAttempts}` : "0/0"} />
          </div>

          <div className="state-copy">
            <strong>{workspaceView.label}</strong>
            <p>{describeWorkspaceStatus(workspaceState)}</p>
            {document?.failureReason ? <p>{document.failureReason}</p> : null}
            {job?.lastError ? <p>{job.lastError}</p> : null}
            {isRecoverableWorkspace(workspaceState) ? (
              <button
                className="primary-button"
                disabled={busy}
                onClick={onRetry}
                type="button"
              >
                {busy ? "Retrying..." : "Retry generation"}
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </div>
  );
}

function isRecoverableWorkspace(workspaceState) {
  const status = workspaceState?.document?.status;
  if (!workspaceState?.document?.id || !status) {
    return false;
  }

  return status === "failed" || status === "parse_failed" || status === "ocr_needed";
}

function buildProcessingBadge(workspaceState) {
  const status = workspaceState?.document?.status;
  if (!status || status === "cards_generated") {
    return null;
  }

  const lastError = workspaceState?.job?.lastError;
  if (status === "failed" || status === "parse_failed" || status === "ocr_needed") {
    return {
      label: "Processing stopped",
      detail: lastError || workspaceState?.document?.failureReason || formatDocumentStatus(status),
    };
  }

  return {
    label: `Document ${formatDocumentStatus(status)}`,
    detail:
      status === "queued"
        ? "The worker has the job and will pick it up shortly."
        : "The worker is parsing and building grounded cards in the background.",
  };
}

function describeWorkspaceStatus(workspaceState) {
  if (!workspaceState?.document && !workspaceState?.deck) {
    return "The private workspace is ready. Upload a paper or paste notes to turn this session into a grounded study feed.";
  }

  if (workspaceState?.deck) {
    return workspaceState.deck.generationMode === "ai"
      ? `Feed ready from ${workspaceState.deck.model}. The cards are grounded in the private source.`
      : workspaceState.deck.warning
        ? `Fallback feed ready. ${workspaceState.deck.warning}`
        : "Feed ready. The cards were generated with the local fallback path because no live model key is configured.";
  }

  const status = workspaceState?.document?.status;
  if (status === "queued") {
    return "The document is queued. The app will refresh as soon as background parsing starts.";
  }
  if (status === "processing") {
    return "The document is processing in the background. Parsing, retrieval prep, and card generation are off the request path now.";
  }
  if (status === "parse_failed" || status === "ocr_needed" || status === "failed") {
    return workspaceState?.document?.failureReason || "Background processing stopped before a feed was ready.";
  }

  return "The private study workspace is ready.";
}

function resolveWorkspaceView(workspaceState, hasReadyDeck = false) {
  const status = workspaceState?.document?.status;
  if (hasReadyDeck || workspaceState?.deck || status === "cards_generated") {
    return {
      kind: "ready",
      badge: "Ready",
      label: "Server-backed feed ready",
      detail: "Cards, citations, and study actions are loaded from persisted state.",
      tone: TONE.recall.style,
    };
  }

  if (status === "failed" || status === "parse_failed" || status === "ocr_needed") {
    return {
      kind: "failed",
      badge: "Needs action",
      label: "Processing stopped",
      detail: "The document is saved, but cards are not ready. Retry when the source or parser path is available.",
      tone: TONE.pitfall.style,
    };
  }

  if (status) {
    return {
      kind: "processing",
      badge: "Processing",
      label: "Document is not ready yet",
      detail: "The background worker owns parsing, retrieval prep, and grounded card generation.",
      tone: TONE.application.style,
    };
  }

  return {
    kind: "empty",
    badge: "No document",
    label: "No active document",
    detail: "Add a source to create a resumable server-backed feed.",
    tone: TONE.glance.style,
  };
}

function formatResumeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recent activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDocumentStatus(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
