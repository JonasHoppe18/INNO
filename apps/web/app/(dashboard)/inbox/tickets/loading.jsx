import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

export default function InboxTicketsLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading tickets"
      className="min-h-full bg-background"
    >
      <span className="sr-only">Loading tickets</span>

      <div className="mx-auto flex w-full max-w-none flex-col px-2 py-2 sm:px-4 lg:px-6">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-1 py-1.5">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>

        <div className="overflow-hidden border-b border-border/70 bg-background">
          <div className="border-b border-border/70 py-3">
            <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div className="flex h-10 items-center gap-1 rounded-md bg-muted/35 p-1">
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>

              <Skeleton className="h-10 w-full xl:w-32" />
            </div>
          </div>

          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-b border-border/80 bg-muted/25 hover:bg-muted/25">
                <TableHead className="w-12 px-4 py-2 sm:px-5">
                  <Skeleton className="size-4 rounded-sm" />
                </TableHead>
                <TableHead className="w-[47%] px-4 py-2 sm:px-5">
                  <Skeleton className="h-3 w-24" />
                </TableHead>
                <TableHead className="w-[11%] px-4 py-2 sm:px-5">
                  <Skeleton className="h-3 w-12" />
                </TableHead>
                <TableHead className="w-[15%] px-4 py-2 sm:px-5">
                  <Skeleton className="h-3 w-10" />
                </TableHead>
                <TableHead className="w-[15%] px-4 py-2 sm:px-5">
                  <Skeleton className="h-3 w-12" />
                </TableHead>
                <TableHead className="w-[12%] px-4 py-2 sm:px-5">
                  <Skeleton className="h-3 w-20" />
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {SKELETON_ROWS.map((row) => (
                <TableRow key={row} className="border-b border-border/70">
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <Skeleton className="size-4 rounded-sm" />
                  </TableCell>
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-36" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <Skeleton className="h-7 w-14 rounded-full" />
                  </TableCell>
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <Skeleton className="h-7 w-24 rounded-full" />
                  </TableCell>
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-8 rounded-full" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 sm:px-5">
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-14" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
