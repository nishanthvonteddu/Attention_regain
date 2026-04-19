import { cookies } from "next/headers.js";

import { getCognitoAuthReport, toClientAuthConfig } from "./config.js";
import {
  createAnonymousProductSession,
  isAuthenticatedProductSession,
  readSerializedProductSession,
  serializeProductSession,
} from "./session-shared.js";

export async function getServerProductShellBootstrap(env = process.env) {
  const authReport = getCognitoAuthReport(env);
  const cookieStore = await cookies();
  const rawSession =
    cookieStore.get(authReport.server.sessionCookieName)?.value || "";

  return {
    auth: toClientAuthConfig(authReport),
    session: rawSession
      ? readSerializedProductSession(rawSession)
      : createAnonymousProductSession("no-auth-cookie"),
  };
}

export function readProductSessionFromCookieHeader(cookieHeader, env = process.env) {
  const authReport = getCognitoAuthReport(env);
  const cookieName = authReport.server.sessionCookieName;
  const match = String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`));
  const rawSession = match ? match.slice(cookieName.length + 1) : "";

  return rawSession
    ? readSerializedProductSession(rawSession)
    : createAnonymousProductSession("no-auth-cookie");
}

export function requestHasAuthenticatedSession(cookieHeader, env = process.env) {
  return isAuthenticatedProductSession(readProductSessionFromCookieHeader(cookieHeader, env));
}

function isSecureRequest(requestUrl) {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildProductSessionCookie(authReport, session, requestUrl) {
  return {
    name: authReport.server.sessionCookieName,
    value: serializeProductSession(session),
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(requestUrl),
    path: "/",
    expires: session.expiresAt ? new Date(session.expiresAt) : undefined,
  };
}

export function buildClearedProductSessionCookie(authReport, requestUrl) {
  return {
    name: authReport.server.sessionCookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(requestUrl),
    path: "/",
    expires: new Date(0),
  };
}
