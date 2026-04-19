import { NextResponse } from "next/server.js";

import { buildCognitoHostedUiUrl, getCognitoAuthReport, toClientAuthConfig } from "../../../../lib/auth/config.js";
import { buildSignInPath, normalizeRedirectPath } from "../../../../lib/auth/flow.js";

export async function GET(request) {
  const authReport = getCognitoAuthReport();
  const auth = toClientAuthConfig(authReport);
  const requestUrl = new URL(request.url);
  const redirectPath = normalizeRedirectPath(
    requestUrl.searchParams.get("redirect"),
    auth.routes.protectedHomePath,
  );

  if (!auth.configured) {
    return NextResponse.redirect(
      new URL(
        buildSignInPath({
          redirectPath,
          error: "cognito_not_configured",
        }),
        request.url,
      ),
    );
  }

  const hostedUiUrl = buildCognitoHostedUiUrl({
    auth,
    origin: requestUrl.origin,
    redirectPath: auth.routes.callbackPath,
    state: redirectPath,
  });

  if (!hostedUiUrl) {
    return NextResponse.redirect(
      new URL(
        buildSignInPath({
          redirectPath,
          error: "access_denied",
        }),
        request.url,
      ),
    );
  }

  return NextResponse.redirect(hostedUiUrl);
}
