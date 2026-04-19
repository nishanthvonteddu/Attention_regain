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

const STORAGE_KEY_PREFIX = "attention-regain-session-v3";

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
  const [deck, setDeck] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "The private workspace is ready. Upload a paper or paste notes to turn this session into a grounded study feed.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deferredDeck = useDeferredValue(deck);
  const visibleDeck = deferredDeck || deck || PREVIEW_DECK;
  const isPreview = !deck;
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
      setDeck(parsed.deck || null);
      setFeedback(parsed.feedback || {});
      if (parsed.deck) {
        setStatusMessage("Private study session restored from this browser.");
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    } finally {
      setHasLoadedStorage(true);
    }
  }, [storageKey]);

  const persistSession = useEffectEvent((nextDeck, nextFeedback) => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        title,
        goal,
        sourceText,
        fileName,
        deck: nextDeck,
        feedback: nextFeedback,
      }),
    );
  });

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }
    persistSession(deck, feedback);
  }, [deck, feedback, fileName, goal, hasLoadedStorage, persistSession, sourceText, storageKey, title]);

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
          ? "Pulling text from the uploaded source and shaping the feed."
          : "Breaking the source into passages and building study cards.",
      );

      const formData = new FormData();
      formData.set("title", title);
      formData.set("goal", goal);
      formData.set("sourceText", sourceText);
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
        setDeck(payload);
        setFeedback({});
      });
      setStatusMessage(
        payload.generationMode === "ai"
          ? `Feed ready from ${payload.model}. The cards are generated from the source inside the private app shell.`
          : payload.warning
            ? `Fallback feed ready. ${payload.warning}`
            : "Feed ready. The cards were generated with the local fallback path because no live model key is configured.",
      );
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

  function applySample() {
    setTitle(SAMPLE_SOURCE.title);
    setGoal(SAMPLE_SOURCE.goal);
    setSourceText(SAMPLE_SOURCE.body);
    setFile(null);
    setFileName("");
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
    setDeck(null);
    setFeedback({});
    setError("");
    setStatusMessage(
      "Private session cleared. Add a paper, notes, or interview reading packet to rebuild the feed.",
    );
    window.localStorage.removeItem(storageKey);
  }

  function onFileChange(nextFile) {
    setFile(nextFile);
    setFileName(nextFile?.name || "");
    setError("");

    if (nextFile) {
      setSourceText("");
      if (!title.trim()) {
        setTitle(nextFile.name.replace(/\.[^.]+$/, ""));
      }
      setStatusMessage(`${nextFile.name} attached. Generate the feed when ready.`);
    }
  }

  function toggleReveal(cardId) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        revealed: !(current[cardId]?.revealed || false),
      },
    }));
  }

  function toggleSave(cardId) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        saved: !(current[cardId]?.saved || false),
      },
    }));
  }

  function setConfidence(cardId, confidence) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || EMPTY_FEEDBACK),
        confidence,
      },
    }));
  }

  const busy = isSubmitting || isPending;

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
                  Good for papers, chapters, and typed notes. This private route keeps
                  the shell protected even while the MVP stays local-first.
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
