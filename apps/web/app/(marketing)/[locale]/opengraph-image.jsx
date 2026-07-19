import { ImageResponse } from "next/og";

// Social share image (email/LinkedIn/Slack previews) for every marketing page.
// Rendered with next/og — a static brand card: dark canvas, the Sona ring,
// wordmark and the headline promise. Localized per /en and /da segment.
export const runtime = "edge";
export const alt = "Sona AI — AI support for webshops";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }) {
  const isDa = params?.locale === "da";
  const title = isDa
    ? "Support der besvarer sig selv."
    : "Support that answers itself.";
  const subtitle = isDa ? "Du beholder kontrollen." : "You stay in control.";
  const tag = isDa ? "AI-support til webshops" : "AI support for webshops";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#09090b",
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.35), transparent 70%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "7px solid #7C7FFF",
              display: "flex",
            }}
          />
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: "#ffffff" }}>
            Sona AI
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 64,
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 64,
            fontWeight: 700,
            color: "#8B8DFF",
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 44,
            fontSize: 26,
            color: "#a1a1aa",
            border: "1px solid #3f3f46",
            borderRadius: 999,
            padding: "10px 28px",
          }}
        >
          {tag}
        </div>
      </div>
    ),
    { ...size }
  );
}
