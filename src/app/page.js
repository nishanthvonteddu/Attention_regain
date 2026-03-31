"use client";

import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";

const STORAGE_KEY = "attention-regain-session-v2";

const SAMPLE_SOURCE = {
  title: "Focused Reading for Interview Preparation",
  goal: "prepare for interviews without drifting into passive rereading",
  body: `
Interview prep fails when reading stays passive. A candidate can spend hours with a system design article or a machine learning paper and still remember very little because the session feels productive without demanding retrieval. Attention needs a task, not just a source.

Working memory is narrow. When a page introduces several new ideas at once, the brain cannot hold all of them with equal clarity. Strong readers reduce load by chunking concepts, naming the main move in each section, and revisiting the thread before the details disappear.

Retrieval practice turns reading into memory. Instead of highlighting another sentence, the learner pauses and asks, "What was the claim here, and why did it matter?" That short pause forces reconstruction. Reconstruction is effortful, but the effort is exactly what makes later recall faster.

Spacing matters because familiarity is deceptive. When the same page is reread immediately, the text feels fluent, and that fluency can be mistaken for understanding. Returning later introduces a little friction, and the friction reveals what has and has not been stored.

Elaboration improves transfer. If a paragraph explains a tradeoff, the learner should connect it to a likely interview question, an exam prompt, or a real decision. A concept becomes more durable when it can be restated in a new setting without copying the original words.

Interleaving keeps attention awake. Mixing architecture, behavioral preparation, and core theory is often more demanding than finishing one topic in a single block, but the switching pressure teaches discrimination. The learner stops relying on pattern repetition and starts identifying what makes one concept different from another.
`.trim(),
};

const PREVIEW_DECK = {
  documentTitle: "Preview Study Feed",
  goal: "see how the scroll format mixes quick reading with active recall",
  focusTags: ["Retrieval", "Spacing", "Transfer", "Attention"],
  stats: {
    estimatedMinutes: 6,
    cardCount: 4,
    chunkCount: 4,
  },
  cards: [
    {
      id: "preview-1",
      kind: "glance",
      title: "Passive reading looks productive before it becomes useful",
      body: "The feed should not generate freeform content. It should keep every card anchored to the uploaded source so the user is still studying the original material.",
      excerpt:
        "The point is to keep every swipe tied back to the actual paper or notes.",
      citation: "Preview",
    },
    {
      id: "preview-2",
      kind: "recall",
      title: "Say it back before you scroll",
      body: "A quick pause matters more than another highlight.",
      question: "What changes when the user has to reconstruct the idea instead of rereading it?",
      answer:
        "Reconstruction creates retrieval effort, and that effort is what makes later recall easier than passive rereading.",
      citation: "Preview",
    },
    {
      id: "preview-3",
      kind: "application",
      title: "Tie the source to the real goal",
      body: "A study feed is stronger when each concept is pointed back at the exam, interview, or decision the user cares about.",
      question: "Where would this idea actually show up under pressure?",
      answer:
        "The user should be able to connect the concept to an interview question, an exam prompt, or a real decision instead of only recognizing the wording.",
      citation: "Preview",
    },
    {
      id: "preview-4",
      kind: "pitfall",
      title: "The easy trap is fluency",
      body: "When something feels smooth right away, users often confuse recognition with understanding.",
      question: "What does quick rereading usually hide?",
      answer:
        "It hides weak recall. The material feels familiar, but the user still cannot explain it cleanly when the source disappears.",
      citation: "Preview",
    },
  ],
};

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

export default function Home() {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [deck, setDeck] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Paste notes or upload a PDF. The generated cards stay grounded in the source.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deferredDeck = useDeferredValue(deck);
  const visibleDeck = deferredDeck || deck || PREVIEW_DECK;
  const isPreview = !deck;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
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
        setStatusMessage("Previous session restored from this browser.");
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasLoadedStorage(true);
    }
  }, []);

  const persistSession = useEffectEvent((nextDeck, nextFeedback) => {
    window.localStorage.setItem(
      STORAGE_KEY,
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
  }, [deck, feedback, fileName, goal, hasLoadedStorage, sourceText, title]);

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
        "Feed ready. The point is to keep the easy scrolling motion while staying inside the material.",
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
      "Sample reading loaded. Generate the feed to inspect the full interaction.",
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
      "Session cleared. Add a paper, notes, or interview reading packet to rebuild the feed.",
    );
    window.localStorage.removeItem(STORAGE_KEY);
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
          <p className="eyebrow">Attention Regain</p>
          <h1 className="hero">Turn distraction into a study loop.</h1>
          <p className="lede">
            One source in. One grounded feed out. The goal of this POC is not to
            replace reading. It is to give people a more useful thing to open when
            attention starts drifting.
          </p>

          <div className="status">
            <p className="eyebrow">Session status</p>
            <p>{statusMessage}</p>
            {error ? <div className="error">{error}</div> : null}
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
                  Good for papers, chapters, and typed notes. This first version
                  keeps everything in a single local app session.
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
              <span>Single document mode</span>
              <em>Intentional</em>
            </div>
            <div className="rule-row">
              <span>Grounded cards with citations</span>
              <em>Required</em>
            </div>
            <div className="rule-row">
              <span>Browser-only session persistence</span>
              <em>Local</em>
            </div>
          </div>
        </div>
      </section>

      <section className="feed-shell">
        <div className="feed-frame">
          <header className="feed-header">
            <p className="feed-mode">{isPreview ? "Preview feed" : "Live study session"}</p>
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
