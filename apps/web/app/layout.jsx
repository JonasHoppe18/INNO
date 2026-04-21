import "./globals.css";
import Providers from "./providers";

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
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
