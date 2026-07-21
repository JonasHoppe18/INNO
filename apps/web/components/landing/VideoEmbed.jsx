"use client";

// Demo-video afspiller. Kilden sættes via NEXT_PUBLIC_DEMO_VIDEO_URL og kan være:
//   - et YouTube-link/ID   → privacy-venlig nocookie-embed
//   - et Vimeo-link/ID     → player-embed
//   - en direkte .mp4/.webm/.mov → native <video controls>
// Er env-varen tom, vises en pæn placeholder (deploy må aldrig vise en tom boks).
const RAW = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || "";

function resolveSource(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  // Direct video file
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(value)) {
    return { kind: "file", src: value };
  }

  // YouTube
  const yt =
    value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/i) ||
    value.match(/^([\w-]{11})$/);
  if (yt) {
    return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
  }

  // Vimeo
  const vimeo = value.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) {
    return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  }

  // Fallback: treat as an embeddable URL as-is
  return { kind: "iframe", src: value };
}

export default function VideoEmbed({ placeholderTitle, placeholderBody, bookCta, bookHref }) {
  const source = resolveSource(RAW);

  if (!source) {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(99,102,241,0.12),transparent_70%)]"
        />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-md">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M8 5.5v11l9-5.5-9-5.5z" fill="#4f46e5" />
          </svg>
        </div>
        <h2 className="relative mt-5 text-lg font-bold text-zinc-900">{placeholderTitle}</h2>
        <p className="relative mt-2 max-w-md px-6 text-sm leading-relaxed text-zinc-500">{placeholderBody}</p>
        <a
          href={bookHref}
          className="relative mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.97]"
        >
          {bookCta}
        </a>
      </div>
    );
  }

  if (source.kind === "file") {
    return (
      <video
        controls
        playsInline
        className="aspect-video w-full overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-[0_24px_80px_-24px_rgba(0,0,0,0.35)]"
        src={source.src}
      />
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-[0_24px_80px_-24px_rgba(0,0,0,0.35)]">
      <iframe
        src={source.src}
        title="Sona demo"
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
