import Link from "next/link";
import { redirect } from "next/navigation";

import { buildSignInPath, getAuthErrorMessage, normalizeRedirectPath } from "../../../lib/auth/flow.js";
import { getServerProductShellBootstrap } from "../../../lib/auth/session.server.js";
import { isAuthenticatedProductSession } from "../../../lib/auth/session-shared.js";

export default async function SignInPage({ searchParams }) {
  const bootstrap = await getServerProductShellBootstrap();
  const requestedRedirect = normalizeRedirectPath(
    searchParams?.redirect,
    bootstrap.auth.routes.protectedHomePath,
  );

  if (isAuthenticatedProductSession(bootstrap.session)) {
    redirect(requestedRedirect);
  }

  const errorCode = typeof searchParams?.error === "string" ? searchParams.error : "";
  const errorMessage = getAuthErrorMessage(errorCode);
  const hostedUiStartPath = `/auth/sign-in/start?redirect=${encodeURIComponent(requestedRedirect)}`;

  return (
    <main className="entry-shell">
      <section className="entry-card">
        <p className="eyebrow">Day 02 Auth Shell</p>
        <h1 className="hero">Choose how this single-user MVP enters the private app.</h1>
        <p className="lede">
          The protected study route lives at <strong>{bootstrap.auth.routes.protectedHomePath}</strong>.
          The local preview sign-in works now. Cognito entry stays visible so the cloud auth path
          can plug in later without reshaping the shell again.
        </p>

        {errorMessage ? <div className="error">{errorMessage}</div> : null}

        <div className="entry-grid">
          <div className="entry-stack">
            <div className="status">
              <p className="eyebrow">Local preview sign-in</p>
              <p>
                Use a name or email to mint a server-issued preview session cookie. This keeps the
                protected-route behavior testable before real Cognito token exchange lands.
              </p>
            </div>

            <form action="/auth/local-sign-in" className="form-grid" method="post">
              <input name="redirect" type="hidden" value={requestedRedirect} />

              <label className="field">
                <span className="field-label">Display name</span>
                <input name="displayName" placeholder="Focused Reader" />
              </label>

              <label className="field">
                <span className="field-label">Email</span>
                <input name="email" placeholder="reader@example.com" type="email" />
              </label>

              <div className="actions">
                <button className="primary-button" type="submit">
                  Enter private app
                </button>
                <Link className="ghost-button" href={buildSignInPath({ redirectPath: requestedRedirect })}>
                  Clear message
                </Link>
              </div>
            </form>
          </div>

          <div className="entry-stack">
            <div className="status">
              <p className="eyebrow">Hosted UI path</p>
              <p>
                {bootstrap.auth.configured
                  ? "Cognito is configured enough to start the Hosted UI redirect."
                  : "Cognito is not configured yet. The Hosted UI start route will redirect back here with a clear failure message."}
              </p>
              {bootstrap.auth.warnings[0] ? <p>{bootstrap.auth.warnings[0]}</p> : null}
            </div>

            <div className="support-list">
              <div className="support-item">
                <strong>Callback</strong>
                <span>{bootstrap.auth.routes.callbackPath}</span>
              </div>
              <div className="support-item">
                <strong>Sign out</strong>
                <span>{bootstrap.auth.routes.signOutPath}</span>
              </div>
              <div className="support-item">
                <strong>Public home</strong>
                <span>{bootstrap.auth.routes.publicHomePath}</span>
              </div>
            </div>

            <div className="actions">
              <Link className="secondary-button" href={hostedUiStartPath}>
                Start Hosted UI
              </Link>
              <Link className="ghost-button" href="/">
                Back to public preview
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

