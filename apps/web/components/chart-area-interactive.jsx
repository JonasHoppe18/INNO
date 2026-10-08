"use client"
import { formatDate } from "@/lib/format/datetime";

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
const chartData = [
  { date: "2024-04-01", tickets: 222, drafts: 150 },
  { date: "2024-04-02", tickets: 97, drafts: 180 },
  { date: "2024-04-03", tickets: 167, drafts: 120 },
  { date: "2024-04-04", tickets: 242, drafts: 260 },
  { date: "2024-04-05", tickets: 373, drafts: 290 },
  { date: "2024-04-06", tickets: 301, drafts: 340 },
  { date: "2024-04-07", tickets: 245, drafts: 180 },
  { date: "2024-04-08", tickets: 409, drafts: 320 },
  { date: "2024-04-09", tickets: 59, drafts: 110 },
  { date: "2024-04-10", tickets: 261, drafts: 190 },
  { date: "2024-04-11", tickets: 327, drafts: 350 },
  { date: "2024-04-12", tickets: 292, drafts: 210 },
  { date: "2024-04-13", tickets: 342, drafts: 380 },
  { date: "2024-04-14", tickets: 137, drafts: 220 },
  { date: "2024-04-15", tickets: 120, drafts: 170 },
  { date: "2024-04-16", tickets: 138, drafts: 190 },
  { date: "2024-04-17", tickets: 446, drafts: 360 },
  { date: "2024-04-18", tickets: 364, drafts: 410 },
  { date: "2024-04-19", tickets: 243, drafts: 180 },
  { date: "2024-04-20", tickets: 89, drafts: 150 },
  { date: "2024-04-21", tickets: 137, drafts: 200 },
  { date: "2024-04-22", tickets: 224, drafts: 170 },
  { date: "2024-04-23", tickets: 138, drafts: 230 },
  { date: "2024-04-24", tickets: 387, drafts: 290 },
  { date: "2024-04-25", tickets: 215, drafts: 250 },
  { date: "2024-04-26", tickets: 75, drafts: 130 },
  { date: "2024-04-27", tickets: 383, drafts: 420 },
  { date: "2024-04-28", tickets: 122, drafts: 180 },
  { date: "2024-04-29", tickets: 315, drafts: 240 },
  { date: "2024-04-30", tickets: 454, drafts: 380 },
  { date: "2024-05-01", tickets: 165, drafts: 220 },
  { date: "2024-05-02", tickets: 293, drafts: 310 },
  { date: "2024-05-03", tickets: 247, drafts: 190 },
  { date: "2024-05-04", tickets: 385, drafts: 420 },
  { date: "2024-05-05", tickets: 481, drafts: 390 },
  { date: "2024-05-06", tickets: 498, drafts: 520 },
  { date: "2024-05-07", tickets: 388, drafts: 300 },
  { date: "2024-05-08", tickets: 149, drafts: 210 },
  { date: "2024-05-09", tickets: 227, drafts: 180 },
  { date: "2024-05-10", tickets: 293, drafts: 330 },
  { date: "2024-05-11", tickets: 335, drafts: 270 },
  { date: "2024-05-12", tickets: 197, drafts: 240 },
  { date: "2024-05-13", tickets: 197, drafts: 160 },
  { date: "2024-05-14", tickets: 448, drafts: 490 },
  { date: "2024-05-15", tickets: 473, drafts: 380 },
  { date: "2024-05-16", tickets: 338, drafts: 400 },
  { date: "2024-05-17", tickets: 499, drafts: 420 },
  { date: "2024-05-18", tickets: 315, drafts: 350 },
  { date: "2024-05-19", tickets: 235, drafts: 180 },
  { date: "2024-05-20", tickets: 177, drafts: 230 },
  { date: "2024-05-21", tickets: 82, drafts: 140 },
  { date: "2024-05-22", tickets: 81, drafts: 120 },
  { date: "2024-05-23", tickets: 252, drafts: 290 },
  { date: "2024-05-24", tickets: 294, drafts: 220 },
  { date: "2024-05-25", tickets: 201, drafts: 250 },
  { date: "2024-05-26", tickets: 213, drafts: 170 },
  { date: "2024-05-27", tickets: 420, drafts: 460 },
  { date: "2024-05-28", tickets: 233, drafts: 190 },
  { date: "2024-05-29", tickets: 78, drafts: 130 },
  { date: "2024-05-30", tickets: 340, drafts: 280 },
  { date: "2024-05-31", tickets: 178, drafts: 230 },
  { date: "2024-06-01", tickets: 178, drafts: 200 },
  { date: "2024-06-02", tickets: 470, drafts: 410 },
  { date: "2024-06-03", tickets: 103, drafts: 160 },
  { date: "2024-06-04", tickets: 439, drafts: 380 },
  { date: "2024-06-05", tickets: 88, drafts: 140 },
  { date: "2024-06-06", tickets: 294, drafts: 250 },
  { date: "2024-06-07", tickets: 323, drafts: 370 },
  { date: "2024-06-08", tickets: 385, drafts: 320 },
  { date: "2024-06-09", tickets: 438, drafts: 480 },
  { date: "2024-06-10", tickets: 155, drafts: 200 },
  { date: "2024-06-11", tickets: 92, drafts: 150 },
  { date: "2024-06-12", tickets: 492, drafts: 420 },
  { date: "2024-06-13", tickets: 81, drafts: 130 },
  { date: "2024-06-14", tickets: 426, drafts: 380 },
  { date: "2024-06-15", tickets: 307, drafts: 350 },
  { date: "2024-06-16", tickets: 371, drafts: 310 },
  { date: "2024-06-17", tickets: 475, drafts: 520 },
  { date: "2024-06-18", tickets: 107, drafts: 170 },
  { date: "2024-06-19", tickets: 341, drafts: 290 },
  { date: "2024-06-20", tickets: 408, drafts: 450 },
  { date: "2024-06-21", tickets: 169, drafts: 210 },
  { date: "2024-06-22", tickets: 317, drafts: 270 },
  { date: "2024-06-23", tickets: 480, drafts: 530 },
  { date: "2024-06-24", tickets: 132, drafts: 180 },
  { date: "2024-06-25", tickets: 141, drafts: 190 },
  { date: "2024-06-26", tickets: 434, drafts: 380 },
  { date: "2024-06-27", tickets: 448, drafts: 490 },
  { date: "2024-06-28", tickets: 149, drafts: 200 },
  { date: "2024-06-29", tickets: 103, drafts: 160 },
  { date: "2024-06-30", tickets: 446, drafts: 400 },
]

const chartConfig = {
  tickets: {
    label: "Tickets",
    color: "#6366f1",
  },

  drafts: {
    label: "Drafts",
    color: "#0ea5e9",
  }
}

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("30d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2024-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader className="relative">
        <CardTitle>Ticket Volume</CardTitle>
        <CardDescription>
          <span className="@[540px]/card:block hidden">
            Incoming emails vs. AI drafts generated
          </span>
          <span className="@[540px]/card:hidden">
            Incoming emails vs. AI drafts generated
          </span>
        </CardDescription>
        <div className="absolute right-4 top-4">
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="@[767px]/card:flex hidden">
            <ToggleGroupItem value="90d" className="h-8 px-2.5">
              Last 3 months
            </ToggleGroupItem>
            <ToggleGroupItem value="30d" className="h-8 px-2.5">
              Last 30 days
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="h-8 px-2.5">
              Last 7 days
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="@[767px]/card:hidden flex w-40" aria-label="Select a value">
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillTickets" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-tickets)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-tickets)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fillDrafts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-drafts)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-drafts)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                return formatDate(value)
              }} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return formatDate(value);
                  }}
                  indicator="dot" />
              } />
            <Area
              dataKey="drafts"
              type="natural"
              fill="url(#fillDrafts)"
              stroke="var(--color-drafts)"
              stackId="a" />
            <Area
              dataKey="tickets"
              type="natural"
              fill="url(#fillTickets)"
              stroke="var(--color-tickets)"
              stackId="a" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
