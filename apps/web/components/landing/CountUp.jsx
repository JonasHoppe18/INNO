"use client";

import { useEffect, useRef, useState } from "react";

// Scroll-triggered number that counts up from 0 the first time it enters the
// viewport, then settles on the canonical `formatted` string.
//
// Hydration-safe: the server passes the final `formatted` string (from
// formatTierPrice) and that exact string is what renders on the server and on
// the client's first paint — so there's no text mismatch even though the server
// (Deno ICU) and browser may format numbers slightly differently. Only after
// mount does it animate, using the numeric `value` + a client-side formatter,
// and it ends back on `formatted` so the displayed price is always canonical.
// Progressive enhancement: no JS / reduced motion → the correct price, no motion.
export default function CountUp({
  value,
  formatted,
  prefix = "",
  suffix = "",
  localeTag = "en-IE",
  durationMs = 1000,
  className,
}) {
  // null → render the canonical `formatted` string; a number → render animated.
  const [display, setDisplay] = useState(null);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || started.current) continue;
          started.current = true;
          const start = performance.now();
          setDisplay(0);
          const tick = (now) => {
            const p = Math.min(1, (now - start) / durationMs);
            const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
            if (p < 1) {
              setDisplay(Math.round(value * eased));
              raf = requestAnimationFrame(tick);
            } else {
              setDisplay(null); // settle on the canonical formatted string
            }
          };
          raf = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display === null ? formatted : `${prefix}${display.toLocaleString(localeTag)}${suffix}`}
    </span>
  );
}
