"use client";

import { createContext, useContext, useState } from "react";

import { getClientProductShell } from "../lib/auth/session.client.js";

const AuthShellContext = createContext(null);

export function AuthShellProvider({ children, initialAuth, initialSession }) {
  const [session, setSession] = useState(initialSession);
  const value = {
    auth: initialAuth,
    session,
    setSession,
    shell: getClientProductShell(initialAuth, session),
  };

  return <AuthShellContext.Provider value={value}>{children}</AuthShellContext.Provider>;
}

export function useAuthShell() {
  const value = useContext(AuthShellContext);

  if (!value) {
    throw new Error("useAuthShell must be used inside AuthShellProvider.");
  }

  return value;
}
