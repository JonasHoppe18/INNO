"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = {
  count: {
    label: "Tickets",
    color: "hsl(var(--primary))",
  },
};

function groupByWeek(data) {
  const weekMap = {};
  for (const { date, count } of data) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day - 1));
    const key = monday.toISOString().slice(0, 10);
    weekMap[key] = (weekMap[key] || 0) + count;
  }
  return Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

function formatXLabel(date, periodDays) {
  const d = new Date(date);
  if (periodDays === "all" || Number(periodDays) >= 90) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

export function TicketVolumeChart({ data = [], periodDays = "30", compact = false }) {
  const useWeeks = periodDays === "all";
  const chartData = useWeeks ? groupByWeek(data) : data;

  if (!chartData.length) {
    return (
      <div className={`flex ${compact ? "min-h-[48px]" : "min-h-[120px]"} items-center justify-center text-sm text-muted-foreground`}>
        No ticket data for this period.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className={`${compact ? "h-[48px]" : "h-[190px] sm:h-[220px]"} w-full`}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.75} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v) => formatXLabel(v, periodDays)}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          allowDecimals={false}
          width={24}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--color-count)", strokeWidth: 1, strokeDasharray: "4 4" }}
          content={
            <ChartTooltipContent
              hideLabel={false}
              labelFormatter={(label) =>
                new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              }
            />
          }
        />
        <Area
          dataKey="count"
          type="monotone"
          stroke="var(--color-count)"
          strokeWidth={2}
          fill="url(#areaGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-count)", strokeWidth: 0 }}
          isAnimationActive
          animationDuration={240}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ChartContainer>
  );
}
