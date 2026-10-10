import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createStatelessServiceClient } from "@/lib/server/stateless-service-client";

import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { ProductAlertsCard } from "@/components/dashboard/ProductAlertsCard";
import { ReturnTrackingDashboardCard } from "@/components/dashboard/ReturnTrackingDashboardCard";
import { SystemStatusLine } from "@/components/dashboard/SystemStatusLine";
import { ThisWeekCards } from "@/components/dashboard/ThisWeekCards";
import { TicketFlowCard } from "@/components/dashboard/TicketFlowCard";
import { UpNextCard } from "@/components/dashboard/UpNextCard";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { openReturnShipments } from "@/lib/dashboard-returns";
import { listReturnTrackingShipments } from "@/lib/server/return-tracking";
import { loadProductRadar } from "@/lib/server/product-radar-data";
import { loadDashboardQueue } from "@/lib/server/dashboard-queue-data";
import { loadSystemStatus } from "@/lib/server/dashboard-status";
import { loadWeekStats } from "@/lib/server/dashboard-week-data";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createStatelessServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Each section loads on its own: one failing source leaves that section out
// instead of blanking the whole page.
function settle(promise, label) {
  return promise.catch((error) => {
    console.error(`Dashboard ${label} lookup failed:`, error);
    return null;
  });
}

export default async function Page() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const serviceClient = createServiceClient();
  let data = {};

  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
      const [status, queue, radar, week, returns] = await Promise.all([
        settle(loadSystemStatus(serviceClient, scope), "status"),
        settle(loadDashboardQueue(serviceClient, scope), "queue"),
        settle(loadProductRadar(serviceClient, scope), "product radar"),
        settle(loadWeekStats(serviceClient, scope), "week"),
        settle(listReturnTrackingShipments(serviceClient, scope), "return tracking"),
      ]);
      data = { status, queue, radar, week, returns };
    } catch (error) {
      console.error("Dashboard scope lookup failed:", error);
    }
  }

  const returnRows = openReturnShipments(data.returns);

  return (
    <div className="@container/main flex flex-1 flex-col bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6 lg:px-7 lg:py-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-page-heading font-semibold tracking-tight">Dashboard</h1>
          <NotificationBell />
        </header>

        <SystemStatusLine status={data.status} />
        {data.queue ? <TicketFlowCard queue={data.queue} /> : null}
        <ProductAlertsCard alerts={data.radar?.alerts ?? []} />
        {data.queue ? <UpNextCard items={data.queue.upNext} /> : null}
        <ThisWeekCards stats={data.week} />
        {returnRows.length ? <ReturnTrackingDashboardCard rows={returnRows} /> : null}
      </div>
    </div>
  );
}
