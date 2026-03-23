"use client";

import { useEffect, useState } from "react";
import { BarChart2Icon, CheckCircle2, Edit3, AlertTriangle, Ruler } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function StatCard({ title, value, description, icon: Icon, badgeClass }) {
  return (
    <Card className="@container/card">
      <CardHeader className="relative">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        {Icon && (
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className={`flex gap-1 rounded-lg text-xs ${badgeClass || ""}`}>
              <Icon className="size-3" />
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function classLabel(key) {
  if (key === "no_edit") return "No edit";
  if (key === "minor_edit") return "Minor edit";
  if (key === "major_edit") return "Major edit";
  return key;
}

function classColor(key) {
  if (key === "no_edit") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (key === "minor_edit") return "border-amber-200 bg-amber-50 text-amber-700";
  if (key === "major_edit") return "border-rose-200 bg-rose-50 text-rose-700";
  return "";
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/analytics/quality")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const categoryRows = data
    ? Object.entries(data.by_category).sort((a, b) => b[1].total - a[1].total)
    : [];

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <BarChart2Icon className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Analytics</h1>
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        Tracks how much agents edit AI-generated drafts after generation.
      </p>

      {loading && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {data.total === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              No sent replies with edit tracking yet. Send a reply to see data here.
            </div>
          ) : (
            <>
              <div className="*:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card">
                <StatCard
                  title="No edit"
                  value={`${data.no_edit_pct}%`}
                  description={`${data.no_edit} of ${data.total} replies sent without changes`}
                  icon={CheckCircle2}
                  badgeClass="border-emerald-200 bg-emerald-50 text-emerald-700"
                />
                <StatCard
                  title="Minor edit"
                  value={`${data.minor_edit_pct}%`}
                  description={
                    data.avg_minor_changed_pct !== null
                      ? `${data.minor_edit} replies — avg. ${data.avg_minor_changed_pct}% changed`
                      : `${data.minor_edit} replies with < 15% changes`
                  }
                  icon={Edit3}
                  badgeClass="border-amber-200 bg-amber-50 text-amber-700"
                />
                <StatCard
                  title="Major edit"
                  value={`${data.major_edit_pct}%`}
                  description={
                    data.avg_major_changed_pct !== null
                      ? `${data.major_edit} replies — avg. ${data.avg_major_changed_pct}% changed`
                      : `${data.major_edit} replies with ≥ 15% changes`
                  }
                  icon={AlertTriangle}
                  badgeClass="border-rose-200 bg-rose-50 text-rose-700"
                />
                <StatCard
                  title="Avg edit distance"
                  value={data.avg_edit_distance ?? "—"}
                  description="Average Levenshtein distance (characters)"
                  icon={Ruler}
                />
              </div>

              {categoryRows.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Breakdown by category</CardTitle>
                    <CardDescription>
                      Edit classification split by ticket type
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">No edit</TableHead>
                            <TableHead className="text-right">Minor</TableHead>
                            <TableHead className="text-right">Major</TableHead>
                            <TableHead className="text-right">No edit %</TableHead>
                            <TableHead className="text-right">Avg. changed</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categoryRows.map(([cat, counts]) => {
                            const noEditPct =
                              counts.total > 0
                                ? Math.round((counts.no_edit / counts.total) * 100)
                                : 0;
                            const classification =
                              noEditPct >= 70
                                ? "no_edit"
                                : noEditPct >= 40
                                ? "minor_edit"
                                : "major_edit";
                            return (
                              <TableRow key={cat}>
                                <TableCell className="font-medium">{cat}</TableCell>
                                <TableCell className="text-right">{counts.total}</TableCell>
                                <TableCell className="text-right text-emerald-700">
                                  {counts.no_edit}
                                </TableCell>
                                <TableCell className="text-right text-amber-700">
                                  {counts.minor_edit}
                                </TableCell>
                                <TableCell className="text-right text-rose-700">
                                  {counts.major_edit}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge
                                    variant="outline"
                                    className={classColor(classification)}
                                  >
                                    {noEditPct}%
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {counts.avg_changed_pct !== null && counts.avg_changed_pct !== undefined
                                    ? `${counts.avg_changed_pct}%`
                                    : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
