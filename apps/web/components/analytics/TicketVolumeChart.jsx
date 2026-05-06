"use client";

import {
  Bar,
  BarChart,
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
    color: "#6366f1",
  },
};

function groupByWeek(data) {
  const weekMap = {};
  for (const { date, count } of data) {
    const d = new Date(date);
    // ISO week start (Monday)
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

export function TicketVolumeChart({ data = [], periodDays = "30" }) {
  const useWeeks = periodDays === "all";
  const chartData = useWeeks ? groupByWeek(data) : data;

  if (!chartData.length) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
        No ticket data for this period.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 12 }}
          tickFormatter={(v) => formatXLabel(v, periodDays)}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 12 }}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
          content={<ChartTooltipContent hideLabel={false} />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ChartContainer>
  );
}
