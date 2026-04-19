import { cookies } from "next/headers";

import { getCognitoAuthReport, toClientAuthConfig } from "./config.js";
import { createAnonymousProductSession, readSerializedProductSession } from "./session-shared.js";

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
