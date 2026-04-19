import { redirect } from "next/navigation";

import { StudyWorkspace } from "../../components/study-workspace.js";
import { buildSignInPath } from "../../lib/auth/flow.js";
import { getServerProductShellBootstrap } from "../../lib/auth/session.server.js";
import { isAuthenticatedProductSession } from "../../lib/auth/session-shared.js";

export default async function PrivateAppPage() {
  const bootstrap = await getServerProductShellBootstrap();

  if (!isAuthenticatedProductSession(bootstrap.session)) {
    redirect(
      buildSignInPath({
        redirectPath: bootstrap.auth.routes.protectedHomePath,
        error: "auth_required",
      }),
    );
  }

  return <StudyWorkspace />;
}

