import "./globals.css";

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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
