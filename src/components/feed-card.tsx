"use client";

import type { StudyCard, StudyCardKind } from "@/lib/study-feed";

export interface CardFeedback {
  confidence: "locked" | "review" | null;
  saved: boolean;
  revealed: boolean;
}

interface FeedCardProps {
  card: StudyCard;
  feedback: CardFeedback;
  index: number;
  onToggleReveal: (cardId: string) => void;
  onSetConfidence: (
    cardId: string,
    confidence: CardFeedback["confidence"],
  ) => void;
  onToggleSave: (cardId: string) => void;
}

const CARD_TONE: Record<
  StudyCardKind,
  {
    label: string;
    accent: string;
    accentSoft: string;
    questionLabel: string;
  }
> = {
  glance: {
    label: "Quick read",
    accent: "#b7542c",
    accentSoft: "rgba(216, 109, 63, 0.12)",
    questionLabel: "Grounded excerpt",
  },
  recall: {
    label: "Active recall",
    accent: "#285747",
    accentSoft: "rgba(40, 87, 71, 0.12)",
    questionLabel: "Recall prompt",
  },
  application: {
    label: "Use it",
    accent: "#7d4d16",
    accentSoft: "rgba(125, 77, 22, 0.12)",
    questionLabel: "Transfer prompt",
  },
  pitfall: {
    label: "Trap door",
    accent: "#74433a",
    accentSoft: "rgba(116, 67, 58, 0.12)",
    questionLabel: "What to avoid",
  },
};

const ACTION_BUTTON =
  "rounded-full border px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em]";

export function FeedCard({
  card,
  feedback,
  index,
  onToggleReveal,
  onSetConfidence,
  onToggleSave,
}: FeedCardProps) {
  const tone = CARD_TONE[card.kind];

  return (
    <article
      className="feed-card-enter overflow-hidden rounded-[30px] border border-black/8 bg-[#faf1e4] p-5 text-[#1b1714] shadow-[0_18px_45px_rgba(13,11,9,0.14)] sm:p-6"
      style={{ animationDelay: `${index * 85}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <p
            className="inline-flex rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.24em]"
            style={{
              backgroundColor: tone.accentSoft,
              color: tone.accent,
            }}
          >
            {tone.label}
          </p>
          <div className="space-y-2">
            <h3 className="max-w-xl font-[family:var(--font-serif)] text-[1.4rem] leading-tight tracking-[-0.03em] sm:text-[1.55rem]">
              {card.title}
            </h3>
            <p className="max-w-2xl text-sm leading-6 text-[#4f453c] sm:text-[0.98rem]">
              {card.body}
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`shrink-0 rounded-full border px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${
            feedback.saved
              ? "border-[#1b1714] bg-[#1b1714] text-[#f8f1e4]"
              : "border-black/10 bg-white/70 text-[#5d544a]"
          }`}
          onClick={() => onToggleSave(card.id)}
        >
          {feedback.saved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="mt-6 rounded-[24px] border border-black/8 bg-white/60 p-4 sm:p-5">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#7b6d60]">
          {card.question ? tone.questionLabel : "Source anchor"}
        </p>
        <p className="mt-3 text-sm leading-6 text-[#2e2722] sm:text-[0.98rem]">
          {card.question ?? card.excerpt}
        </p>

        {card.answer ? (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="rounded-full border border-black/10 bg-[#1b1714] px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[#f9f2e7]"
              onClick={() => onToggleReveal(card.id)}
            >
              {feedback.revealed ? "Hide answer" : "Reveal answer"}
            </button>
            {feedback.revealed ? (
              <p className="rounded-[20px] bg-[#efe7da] px-4 py-4 text-sm leading-6 text-[#3a312a] sm:text-[0.96rem]">
                {card.answer}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-black/8 pt-4">
        <button
          type="button"
          className={`${ACTION_BUTTON} ${
            feedback.confidence === "locked"
              ? "border-[#285747] bg-[#285747] text-[#f5efe4]"
              : "border-black/10 bg-white/50 text-[#4f453c]"
          }`}
          onClick={() =>
            onSetConfidence(
              card.id,
              feedback.confidence === "locked" ? null : "locked",
            )
          }
        >
          Locked in
        </button>
        <button
          type="button"
          className={`${ACTION_BUTTON} ${
            feedback.confidence === "review"
              ? "border-[#9a6408] bg-[#9a6408] text-[#f5efe4]"
              : "border-black/10 bg-white/50 text-[#4f453c]"
          }`}
          onClick={() =>
            onSetConfidence(
              card.id,
              feedback.confidence === "review" ? null : "review",
            )
          }
        >
          Review again
        </button>
        <span className="ml-auto text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#7b6d60]">
          {card.citation}
        </span>
      </div>
    </article>
  );
}
