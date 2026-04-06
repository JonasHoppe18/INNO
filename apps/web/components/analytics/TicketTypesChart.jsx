"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function formatTag(tag) {
  if (!tag) return "";
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderActiveShape(props) {
  const {
    cx, cy,
    innerRadius, outerRadius,
    startAngle, endAngle,
    fill,
    payload,
    percent,
  } = props;

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 13, fontWeight: 600, fill: "currentColor" }}
      >
        {formatTag(payload.tag)}
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
      >
        {payload.count} · {Math.round(percent * 100)}%
      </text>
    </g>
  );
}

export function TicketTypesChart({ data = [] }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!data.length) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
        No ticket categories yet — ticket tags will appear here.
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  // Show top 8, group the rest as "Other"
  const top = data.slice(0, 8);
  const rest = data.slice(8);
  const chartData =
    rest.length > 0
      ? [
          ...top,
          { tag: "Other", count: rest.reduce((s, d) => s + d.count, 0) },
        ]
      : top;

  const config = Object.fromEntries(
    chartData.map((d, i) => [
      d.tag,
      { label: formatTag(d.tag), color: COLORS[i % COLORS.length] },
    ])
  );

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="h-[260px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="tag" hideLabel />} />
          <Pie
            data={chartData}
            dataKey="count"
            nameKey="tag"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            activeIndex={activeIndex ?? undefined}
            activeShape={activeIndex !== null ? renderActiveShape : undefined}
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={entry.tag}
                fill={COLORS[index % COLORS.length]}
                stroke="transparent"
                className="cursor-pointer"
              />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="tag" />} />
        </PieChart>
      </ChartContainer>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="text-right font-semibold">Count</TableHead>
              <TableHead className="text-right font-semibold">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow key={row.tag} className="transition-colors hover:bg-muted/30">
                <TableCell className="flex items-center gap-2 font-medium">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  {formatTag(row.tag)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {total > 0 ? Math.round((row.count / total) * 100) : 0}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
