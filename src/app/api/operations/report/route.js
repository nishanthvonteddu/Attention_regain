import {
  readProductSessionFromCookieHeader,
  requestHasAuthenticatedSession,
} from "../../../../lib/auth/session.server.js";
import { getDefaultStudyRepository } from "../../../../lib/data/repositories.js";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const session = readProductSessionFromCookieHeader(request.headers.get("cookie"));
    if (!requestHasAuthenticatedSession(request.headers.get("cookie"))) {
      return Response.json(
        { error: "Sign in before loading operational health." },
        { status: 401 },
      );
    }

    const report = await getDefaultStudyRepository().getOperationalReportForUser(session.user.id);
    return Response.json({ report });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load operational health.",
      },
      { status: 500 },
    );
  }
}
