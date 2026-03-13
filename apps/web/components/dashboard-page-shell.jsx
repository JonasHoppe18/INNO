import { cn } from "@/lib/utils";

export function DashboardPageShell({ children, className }) {
  return (
    <main
      className={cn("min-w-0 w-full space-y-6 bg-white px-4 py-6 lg:px-10 lg:py-10", className)}
    >
      {children}
    </main>
  );
}
