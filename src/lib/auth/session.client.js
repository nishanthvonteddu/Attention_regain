export {
  createAnonymousProductSession,
  createAuthenticatedProductSession,
  isAuthenticatedProductSession,
  readSerializedProductSession,
  serializeProductSession,
} from "./session-shared.js";

import { getProductShellState, isAuthenticatedProductSession } from "./session-shared.js";

export function getClientProductShell(auth, session) {
  return {
    ...getProductShellState({ auth, session }),
    canAccessPrivateApp: isAuthenticatedProductSession(session),
    canStartHostedUi: Boolean(auth?.configured),
  };
}
