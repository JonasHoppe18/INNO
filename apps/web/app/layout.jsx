import "./globals.css";
import Providers from "./providers";
import localFont from "next/font/local";

const inter = localFont({
  src: [
    { path: "./fonts/InterVariable.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/InterVariable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "Sona AI",
  description:
    "INNO web app - get a clear view of customer service and integrations in your browser.",
  icons: {
    icon: "/icon.svg",
  },
};

// Wrapper layout der sætter globale providers og <html lang="da">
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
