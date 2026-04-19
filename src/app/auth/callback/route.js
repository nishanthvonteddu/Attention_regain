import { NextResponse } from "next/server.js";

import { getCognitoAuthReport } from "../../../lib/auth/config.js";
import { buildSignInPath, normalizeRedirectPath } from "../../../lib/auth/flow.js";

export async function GET(request) {
  const authReport = getCognitoAuthReport();
  const requestUrl = new URL(request.url);
  const redirectPath = normalizeRedirectPath(
    requestUrl.searchParams.get("state"),
    authReport.routes.protectedHomePath,
  );

  if (!authReport.configured) {
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

  if (requestUrl.searchParams.get("error")) {
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

  if (!requestUrl.searchParams.get("code")) {
    return NextResponse.redirect(
      new URL(
        buildSignInPath({
          redirectPath,
          error: "callback_missing_code",
        }),
        request.url,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(
      buildSignInPath({
        redirectPath,
        error: "callback_exchange_not_implemented",
      }),
      request.url,
    ),
  );
}
