import { NextResponse } from "next/server.js";

import { buildCognitoLogoutUrl, getCognitoAuthReport, toClientAuthConfig } from "../../../lib/auth/config.js";
import { buildClearedProductSessionCookie } from "../../../lib/auth/session.server.js";

function createSignOutResponse(request) {
  const authReport = getCognitoAuthReport();
  const auth = toClientAuthConfig(authReport);
  const requestUrl = new URL(request.url);
  const logoutUrl = buildCognitoLogoutUrl({
    auth,
    origin: requestUrl.origin,
  });
  const response = NextResponse.redirect(
    logoutUrl || new URL(auth.routes.publicHomePath, request.url),
  );

  response.cookies.set(buildClearedProductSessionCookie(authReport, request.url));
  return response;
}

export async function GET(request) {
  return createSignOutResponse(request);
}

export async function POST(request) {
  return createSignOutResponse(request);
}
