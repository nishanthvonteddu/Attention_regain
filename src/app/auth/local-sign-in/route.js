import { NextResponse } from "next/server.js";

import { getCognitoAuthReport } from "../../../lib/auth/config.js";
import { buildSignInPath, normalizeRedirectPath } from "../../../lib/auth/flow.js";
import {
  buildProductSessionCookie,
} from "../../../lib/auth/session.server.js";
import { createAuthenticatedProductSession } from "../../../lib/auth/session-shared.js";

function createStableLocalUserId(displayName, email) {
  const base = (email || displayName || "reader")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `local-${base || "reader"}`;
}

export async function POST(request) {
  const authReport = getCognitoAuthReport();
  const formData = await request.formData();
  const displayName = String(formData.get("displayName") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const redirectPath = normalizeRedirectPath(
    String(formData.get("redirect") || ""),
    authReport.routes.protectedHomePath,
  );

  if (!displayName && !email) {
    return NextResponse.redirect(
      new URL(
        buildSignInPath({
          redirectPath,
          error: "missing_identity",
        }),
        request.url,
      ),
    );
  }

  const session = createAuthenticatedProductSession({
    userId: createStableLocalUserId(displayName, email),
    email,
    displayName,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    source: "local-preview-sign-in",
  });
  const response = NextResponse.redirect(new URL(redirectPath, request.url));

  response.cookies.set(buildProductSessionCookie(authReport, session, request.url));
  return response;
}
