"use client";

import Link from "next/link";

import { useAuthShell } from "../components/auth-shell-provider.js";
import { PREVIEW_DECK } from "../lib/study-preview.js";

const PREVIEW_RULES = [
  "Anonymous users stay in public preview mode.",
  "Private study intake moves to /app behind a server session cookie.",
  "Cognito can plug in later without changing the shell boundary again.",
];

const TONE = {
  glance: {
    label: "Quick read",
    style: { backgroundColor: "rgba(217, 108, 63, 0.12)", color: "#b5552e" },
  },
  recall: {
    label: "Active recall",
    style: { backgroundColor: "rgba(41, 88, 70, 0.12)", color: "#295846" },
  },
  application: {
    label: "Use it",
    style: { backgroundColor: "rgba(145, 93, 10, 0.12)", color: "#7b5008" },
  },
  pitfall: {
    label: "Trap door",
    style: { backgroundColor: "rgba(120, 67, 58, 0.12)", color: "#74433a" },
  },
};

export default function Home() {
  const { auth, session, shell } = useAuthShell();
  const privateHref = auth.routes.protectedHomePath;
  const signInHref = `/auth/sign-in?redirect=${encodeURIComponent(privateHref)}`;
  const primaryHref = shell.canAccessPrivateApp ? privateHref : signInHref;
  const primaryLabel = shell.canAccessPrivateApp ? "Open private app" : "Sign in to continue";

  return (
    <main className="shell">
      <section className="panel">
        <div className="panel-inner">
          <div className="panel-glow" />
          <p className="eyebrow">Attention Regain</p>
          <h1 className="hero">A public preview outside the private study route.</h1>
          <p className="lede">
            Day 2 moves the real study workflow behind a server-issued session cookie.
            The public home stays open so the product can explain itself before the user
            crosses into the protected app shell.
          </p>

          <div className="status">
            <p className="eyebrow">Auth shell</p>
            <p>
              <strong>{shell.label}.</strong> {shell.description}
            </p>
            {session.user ? (
              <p>
                Signed in as <strong>{session.user.displayName || session.user.email || session.user.id}</strong>.
              </p>
            ) : null}
            {auth.warnings[0] ? <p>{auth.warnings[0]}</p> : null}
          </div>

          <div className="actions">
            <Link className="primary-button" href={primaryHref}>
              {primaryLabel}
            </Link>
            <Link className="secondary-button" href="/auth/sign-in?redirect=%2Fapp">
              View sign-in options
            </Link>
            {shell.canAccessPrivateApp ? (
              <form action={auth.routes.signOutPath} method="post">
                <button className="ghost-button" type="submit">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>

          <div className="rules">
            {PREVIEW_RULES.map((rule) => (
              <div className="rule-row" key={rule}>
                <span>{rule}</span>
                <em>Day 02</em>
              </div>
            ))}
            <div className="rule-row">
              <span>Private route target</span>
              <em>{auth.routes.protectedHomePath}</em>
            </div>
          </div>
        </div>
      </section>

      <section className="feed-shell" id="preview">
        <div className="feed-frame">
          <header className="feed-header">
            <p className="feed-mode">Public preview</p>
            <div className="feed-summary">
              <div>
                <h2 className="feed-title">{PREVIEW_DECK.documentTitle}</h2>
                <p className="feed-goal">
                  {PREVIEW_DECK.goal}
                </p>
              </div>
              <div className="preview-badge">
                <strong>{shell.canAccessPrivateApp ? "Private app ready" : "Protected route ahead"}</strong>
                <span>
                  {shell.canAccessPrivateApp
                    ? "Your session can open /app immediately."
                    : "Sign in first, then the real workspace opens on /app."}
                </span>
              </div>
            </div>

            <div className="tag-row">
              {PREVIEW_DECK.focusTags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </header>

          <div className="feed-body">
            <div className="feed-column">
              {PREVIEW_DECK.cards.map((card) => {
                const tone = TONE[card.kind] || TONE.glance;

                return (
                  <article className="feed-card" key={card.id}>
                    <div className="feed-card-head">
                      <div>
                        <span className="tone" style={tone.style}>
                          {tone.label}
                        </span>
                        <h3>{card.title}</h3>
                      </div>
                      <span className="pill">Preview</span>
                    </div>
                    <p>{card.body}</p>
                    <div className="card-prompt">
                      <strong>{card.question ? "Preview prompt" : "Source anchor"}</strong>
                      <p>{card.question || card.excerpt}</p>
                      {card.answer ? <div className="answer">{card.answer}</div> : null}
                    </div>
                    <div className="card-actions">
                      <Link className="pill" href={primaryHref}>
                        {shell.canAccessPrivateApp ? "Open app" : "Sign in"}
                      </Link>
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

