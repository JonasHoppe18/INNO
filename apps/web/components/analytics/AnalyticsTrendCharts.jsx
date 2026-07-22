"use client";

import { useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

function formatDate(value) {
  if (!value) return "";
  const normalized = value.length === 7 ? `${value}-01` : value;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: value.length === 7 ? undefined : "numeric" });
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 10,
  tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
};

export function SupportFlowChart({ data = [] }) {
  const reduceMotion = useReducedMotion();
  const config = {
    created: { label: "Created", color: "hsl(var(--primary))" },
    solved: { label: "Solved", color: "hsl(142 71% 45%)" },
  };

  return (
    <ChartContainer config={config} className="h-[250px] w-full">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={formatDate} interval="preserveStartEnd" />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <ChartTooltip
          cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "4 4" }}
          content={<ChartTooltipContent labelFormatter={(label) => formatDate(label)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="created" type="monotone" stroke="var(--color-created)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={240} />
        <Line dataKey="solved" type="monotone" stroke="var(--color-solved)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={240} />
      </LineChart>
    </ChartContainer>
  );
}

function RateAreaChart({ data, dataKey, label, supportingKeys = [] }) {
  const reduceMotion = useReducedMotion();
  const config = {
    [dataKey]: { label, color: "hsl(var(--primary))" },
    ...Object.fromEntries(supportingKeys.map(({ key, label: supportingLabel }) => [key, { label: supportingLabel, color: "hsl(var(--muted-foreground))" }])),
  };

  return (
    <ChartContainer config={config} className="h-[250px] w-full">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id={`${dataKey}-gradient`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.18} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={formatDate} interval="preserveStartEnd" />
        <YAxis {...axisProps} width={34} tickFormatter={(value) => `${value}%`} />
        <ChartTooltip
          cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "4 4" }}
          content={
            <ChartTooltipContent
              labelFormatter={(tooltipLabel) => formatDate(tooltipLabel)}
              formatter={(value, name, _item, _index, row) => (
                <div className="flex w-full flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-muted-foreground">{config[name]?.label || name}</span>
                    <span className="font-mono font-medium tabular-nums">{value == null ? "—" : `${value}%`}</span>
                  </div>
                  {supportingKeys.map(({ key, label: supportingLabel }) => (
                    <div key={key} className="flex items-center justify-between gap-6">
                      <span className="text-muted-foreground">{supportingLabel}</span>
                      <span className="font-mono font-medium tabular-nums">{Number(row?.[key] || 0).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            />
          }
        />
        <Area dataKey={dataKey} type="monotone" stroke={`var(--color-${dataKey})`} strokeWidth={2} fill={`url(#${dataKey}-gradient)`} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduceMotion} animationDuration={240} />
      </AreaChart>
    </ChartContainer>
  );
}

export function CommerceRateChart({ data = [] }) {
  return <RateAreaChart data={data} dataKey="ticketsPer100Orders" label="Tickets per 100 orders" supportingKeys={[{ key: "orders", label: "Orders" }, { key: "linkedTickets", label: "Linked tickets" }]} />;
}

export function SonaRateChart({ data = [] }) {
  return <RateAreaChart data={data} dataKey="assistedRate" label="Assisted rate" supportingKeys={[{ key: "supportTickets", label: "Support tickets" }, { key: "assistedTickets", label: "Assisted tickets" }]} />;
}
