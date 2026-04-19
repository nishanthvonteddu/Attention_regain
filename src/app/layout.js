import "./globals.css";
import { AuthShellProvider } from "../components/auth-shell-provider.js";
import { getServerProductShellBootstrap } from "../lib/auth/session.server.js";

export const metadata = {
  title: "Attention Regain",
  description:
    "Turn papers and notes into a grounded study feed that is easier to reopen than social media.",
  applicationName: "Attention Regain",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#15120f",
};

export default async function RootLayout({ children }) {
  const { auth, session } = await getServerProductShellBootstrap();

  return (
    <html lang="en">
      <body>
        <AuthShellProvider initialAuth={auth} initialSession={session}>
          {children}
        </AuthShellProvider>
      </body>
    </html>
  );
}
