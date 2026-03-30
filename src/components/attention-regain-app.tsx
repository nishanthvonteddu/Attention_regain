"use client";

import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";
import { demoDeck, MAX_SOURCE_CHARS, sampleSource, type StudyDeck } from "@/lib/study-feed";
import { CardFeedback, FeedCard } from "@/components/feed-card";

type FeedbackMap = Record<string, CardFeedback>;

interface PersistedSession {
  deck: StudyDeck | null;
  feedback: FeedbackMap;
  form: {
    title: string;
    goal: string;
    sourceText: string;
    fileName: string;
  };
}

const STORAGE_KEY = "attention-regain-session-v1";
const EMPTY_FEEDBACK: CardFeedback = {
  confidence: null,
  saved: false,
  revealed: false,
};

export function AttentionRegainApp() {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [deck, setDeck] = useState<StudyDeck | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMap>({});
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Paste notes or drop a paper. The feed will stay anchored to that material.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deferredDeck = useDeferredValue(deck);
  const visibleDeck = deferredDeck ?? deck ?? demoDeck;
  const usingPreview = !deck;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved) as PersistedSession;
      if (parsed.deck) {
        setDeck(parsed.deck);
      }
      if (parsed.feedback) {
        setFeedback(parsed.feedback);
      }
      if (parsed.form) {
        setTitle(parsed.form.title ?? "");
        setGoal(parsed.form.goal ?? "");
        setSourceText(parsed.form.sourceText ?? "");
        setFileName(parsed.form.fileName ?? "");
      }
      if (parsed.deck) {
        setStatusMessage("Previous session restored from this browser.");
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasLoadedStorage(true);
    }
  }, []);

  const persistSession = useEffectEvent(
    (nextDeck: StudyDeck | null, nextFeedback: FeedbackMap) => {
      const payload: PersistedSession = {
        deck: nextDeck,
        feedback: nextFeedback,
        form: {
          title,
          goal,
          sourceText,
          fileName,
        },
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
  );

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }
    persistSession(deck, feedback);
  }, [
    deck,
    feedback,
    fileName,
    goal,
    hasLoadedStorage,
    sourceText,
    title,
  ]);

  const feedbackValues = Object.values(feedback);
  const sessionStats = {
    locked: feedbackValues.filter((entry) => entry.confidence === "locked")
      .length,
    review: feedbackValues.filter((entry) => entry.confidence === "review")
      .length,
    saved: feedbackValues.filter((entry) => entry.saved).length,
    revealed: feedbackValues.filter((entry) => entry.revealed).length,
  };

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!sourceText.trim() && !file) {
      setError("Add some source material first. Paste text or upload a PDF.");
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage(
        file
          ? "Pulling text from the document and shaping a grounded feed."
          : "Breaking the source into passages and turning them into study cards.",
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

      const payload = (await response.json()) as StudyDeck | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Could not build the study feed.",
        );
      }

      startTransition(() => {
        setDeck(payload);
        setFeedback({});
      });
      setStatusMessage(
        "Feed ready. Scroll through the material instead of drifting away from it.",
      );
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Could not build the study feed.";
      setError(message);
      setStatusMessage("The source needs a cleaner input before it can become a feed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function applySample() {
    setTitle(sampleSource.title);
    setGoal(sampleSource.goal);
    setSourceText(sampleSource.body);
    setFile(null);
    setFileName("");
    setError(null);
    setStatusMessage(
      "Sample reading loaded. Generate the feed to inspect the full interaction.",
    );
  }

  function clearSession() {
    setTitle("");
    setGoal("");
    setSourceText("");
    setFile(null);
    setFileName("");
    setDeck(null);
    setFeedback({});
    setError(null);
    setStatusMessage(
      "Session cleared. Add a new paper, note set, or interview reading packet.",
    );
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function handleFileSelection(nextFile: File | null) {
    setFile(nextFile);
    setFileName(nextFile?.name ?? "");
    setError(null);

    if (nextFile) {
      setSourceText("");
      if (!title.trim()) {
        setTitle(nextFile.name.replace(/\.[^.]+$/, ""));
      }
      setStatusMessage(
        `${nextFile.name} is attached. Generate the feed when you are ready.`,
      );
    }
  }

  function toggleReveal(cardId: string) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] ?? EMPTY_FEEDBACK),
        revealed: !(current[cardId]?.revealed ?? false),
      },
    }));
  }

  function setConfidence(cardId: string, confidence: CardFeedback["confidence"]) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] ?? EMPTY_FEEDBACK),
        confidence,
      },
    }));
  }

  function toggleSave(cardId: string) {
    setFeedback((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] ?? EMPTY_FEEDBACK),
        saved: !(current[cardId]?.saved ?? false),
      },
    }));
  }

  const busy = isSubmitting || isPending;

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8">
      <div className="grid min-h-[calc(100vh-2rem)] gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <section className="panel-surface section-enter relative overflow-hidden rounded-[34px] p-5 sm:p-7 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="ambient-float absolute right-[-22px] top-[-22px] h-28 w-28 rounded-full bg-[var(--accent-soft)] blur-2xl" />
          <div className="relative">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.34em] text-[var(--accent-strong)]">
              Attention Regain
            </p>
            <h1 className="mt-4 max-w-[14ch] font-[family:var(--font-serif)] text-[2.8rem] leading-[0.93] tracking-[-0.05em] sm:text-[3.6rem]">
              Turn distraction into a study loop.
            </h1>
            <p className="mt-4 max-w-xl text-[0.98rem] leading-7 text-[var(--muted)]">
              One paper in. One grounded feed out. The POC keeps everything in a
              single Next.js app so the real product question stays visible:
              will people open this instead of social media when attention slips?
            </p>
          </div>

          <div className="mt-8 rounded-[28px] border border-black/8 bg-white/42 p-4 sm:p-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[var(--accent-strong)]">
              Session status
            </p>
            <p className="mt-3 text-sm leading-6 text-[#4b4239]">{statusMessage}</p>
            {error ? (
              <p className="mt-3 rounded-[18px] bg-[#f9e2da] px-3 py-3 text-sm text-[#7c3520]">
                {error}
              </p>
            ) : null}
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleGenerate}>
            <label className="block space-y-2">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[#6c6257]">
                Document title
              </span>
              <input
                className="w-full rounded-[20px] border border-black/8 bg-[#fffaf2] px-4 py-3 text-sm text-[#241d18] placeholder:text-[#9a8f83]"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Neural networks paper, exam notes, interview packet"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[#6c6257]">
                Study goal
              </span>
              <input
                className="w-full rounded-[20px] border border-black/8 bg-[#fffaf2] px-4 py-3 text-sm text-[#241d18] placeholder:text-[#9a8f83]"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Prepare for interviews, revise for an exam, explain a paper"
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[#6c6257]">
                  Source text
                </span>
                <span className="text-[0.7rem] uppercase tracking-[0.18em] text-[#8a7e72]">
                  {sourceText.length}/{MAX_SOURCE_CHARS}
                </span>
              </div>
              <textarea
                className="min-h-[220px] w-full rounded-[24px] border border-black/8 bg-[#fffaf2] px-4 py-4 text-sm leading-6 text-[#241d18] placeholder:text-[#9a8f83]"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="Paste a chapter summary, a paper section, lecture notes, or a reading packet excerpt."
              />
              <p className="text-sm leading-6 text-[#7b6f63]">
                Paste text for the fastest demo, or upload a PDF/TXT file below.
              </p>
            </div>

            <div className="space-y-3">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[#6c6257]">
                Upload file
              </span>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-black/15 bg-[#fffaf2] px-5 py-7 text-center">
                <span className="text-sm font-semibold text-[#221c17]">
                  Drop a PDF or text file here
                </span>
                <span className="mt-2 text-sm leading-6 text-[#7b6f63]">
                  Good for papers, chapters, and typed notes. The current POC keeps
                  processing in this local app session.
                </span>
                <span className="mt-4 rounded-full border border-black/10 bg-white px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[#554c43]">
                  Choose file
                </span>
                <input
                  className="hidden"
                  type="file"
                  accept=".pdf,.txt,.md,.text"
                  onChange={(event) =>
                    handleFileSelection(event.target.files?.[0] ?? null)
                  }
                />
              </label>
              {fileName ? (
                <div className="flex items-center justify-between gap-3 rounded-[20px] border border-black/8 bg-white/55 px-4 py-3 text-sm text-[#483f36]">
                  <span className="truncate">{fileName}</span>
                  <button
                    type="button"
                    className="rounded-full border border-black/10 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em]"
                    onClick={() => handleFileSelection(null)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                className="rounded-full bg-[#1b1714] px-5 py-3 text-[0.76rem] font-semibold uppercase tracking-[0.22em] text-[#f6efe4] disabled:opacity-55"
                disabled={busy}
              >
                {busy ? "Building feed..." : "Generate grounded feed"}
              </button>
              <button
                type="button"
                className="rounded-full border border-black/10 bg-white/70 px-5 py-3 text-[0.76rem] font-semibold uppercase tracking-[0.22em] text-[#3f372f]"
                onClick={applySample}
              >
                Load sample source
              </button>
              <button
                type="button"
                className="rounded-full border border-black/10 bg-transparent px-5 py-3 text-[0.76rem] font-semibold uppercase tracking-[0.22em] text-[#6b6258]"
                onClick={clearSession}
              >
                Reset session
              </button>
            </div>
          </form>

          <div className="mt-8 border-t border-black/8 pt-6">
            <div className="space-y-4 text-sm text-[#493f36]">
              <div className="flex items-center justify-between gap-4">
                <span>Single document mode</span>
                <span className="text-[0.74rem] uppercase tracking-[0.18em] text-[#7f7266]">
                  Intentional
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-black/8 pt-4">
                <span>Grounded cards with citations</span>
                <span className="text-[0.74rem] uppercase tracking-[0.18em] text-[#7f7266]">
                  Required
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-black/8 pt-4">
                <span>Local session persistence</span>
                <span className="text-[0.74rem] uppercase tracking-[0.18em] text-[#7f7266]">
                  Browser only
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="section-enter relative overflow-hidden rounded-[36px] bg-[var(--surface-dark)] p-3 shadow-[0_25px_80px_rgba(18,13,9,0.24)] sm:p-4">
          <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(216,109,63,0.22),transparent_65%)]" />
          <div className="relative flex h-full min-h-[72vh] flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[rgba(10,8,7,0.34)]">
            <div className="sticky top-0 z-10 border-b border-white/8 bg-[rgba(19,16,13,0.85)] px-4 py-4 backdrop-blur-md sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[#efb08f]">
                    {usingPreview ? "Preview feed" : "Live study session"}
                  </p>
                  <div>
                    <h2 className="max-w-3xl font-[family:var(--font-serif)] text-[1.8rem] leading-tight tracking-[-0.04em] text-[#f7efe2] sm:text-[2.2rem]">
                      {visibleDeck.documentTitle}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#d3c4b4] sm:text-[0.98rem]">
                      {visibleDeck.goal}
                    </p>
                  </div>
                </div>
                <div className="text-right text-sm text-[#d8c8b8]">
                  <p className="font-semibold text-[#f7efe2]">
                    {visibleDeck.stats.estimatedMinutes} min source
                  </p>
                  <p className="mt-1 text-[#b7a796]">
                    {visibleDeck.stats.cardCount} cards from {visibleDeck.stats.chunkCount} passages
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {visibleDeck.focusTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#d7c7b6]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Locked in" value={sessionStats.locked} />
                <Metric label="Review again" value={sessionStats.review} />
                <Metric label="Saved" value={sessionStats.saved} />
                <Metric
                  label="Revealed"
                  value={sessionStats.revealed}
                />
              </div>
            </div>

            <div className="overflow-y-auto px-3 py-4 sm:px-4 sm:py-5">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-10">
                {visibleDeck.cards.map((card, index) => (
                  <FeedCard
                    key={card.id}
                    card={card}
                    feedback={feedback[card.id] ?? EMPTY_FEEDBACK}
                    index={index}
                    onToggleReveal={toggleReveal}
                    onSetConfidence={setConfidence}
                    onToggleSave={toggleSave}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/4 px-4 py-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#bfae9e]">
        {label}
      </p>
      <p className="mt-2 text-[1.35rem] font-semibold tracking-[-0.03em] text-[#f8f0e4]">
        {value}
      </p>
    </div>
  );
}
