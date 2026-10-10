import Link from "next/link";
import { ArrowDownRightIcon, ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { weekCards } from "@/lib/dashboard-week-copy";

// Weeks without data are skipped. Where lower is better the line is flipped,
// so improvement always points up.
function Sparkline({ series = [], invert = false, id }) {
  const width = 160;
  const height = 36;
  const known = series.map((value, index) => [index, value]).filter(([, value]) => value != null);
  if (known.length < 2) return <div className="h-9" aria-hidden="true" />;
  const values = known.map(([, value]) => value);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const points = known.map(([index, value]) => {
    const share = (value - min) / range;
    return [(index / (series.length - 1)) * width, height - 3 - (invert ? 1 - share : share) * (height - 6)];
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${points[0][0].toFixed(1)},${height} ${line} ${points.at(-1)[0].toFixed(1)},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-9 w-full text-primary" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ThisWeekCards({ stats }) {
  const cards = weekCards(stats);
  if (!cards.length) return null;
  return (
    <section aria-labelledby="this-week" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="this-week" className="text-section-heading font-semibold">This week</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/analytics">Analytics<ChevronRightIcon data-icon="inline-end" /></Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Arrow = card.change?.label.startsWith("−") ? ArrowDownRightIcon : ArrowUpRightIcon;
          return (
            <Card key={card.key} className="flex flex-col gap-1 overflow-hidden rounded-xl p-4 pb-0 shadow-sm">
              <div className="flex min-h-5 items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{card.label}</p>
                {card.change ? (
                  <span className={cn("flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums", card.change.good ? "bg-success text-success-foreground" : "bg-danger text-danger-foreground")}>
                    <Arrow className="size-3" aria-hidden="true" />{card.change.label}
                    <span className="sr-only"> vs last week</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.detail}</p>
              <div className="-mx-4 mt-2"><Sparkline series={card.series} invert={card.lowerIsBetter} id={`week-spark-${card.key}`} /></div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
