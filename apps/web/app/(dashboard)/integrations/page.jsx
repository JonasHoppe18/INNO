import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ShopifyConnectCard } from "@/components/integrations/ShopifyConnectCard";
import { WebshipperCard } from "@/components/integrations/WebshipperCard";
import { FreshdeskConnectCard } from "@/components/integrations/FreshdeskConnectCard";
import { GorgiasConnectCard } from "@/components/integrations/GorgiasConnectCard";
import { ZendeskConnectCard } from "@/components/integrations/ZendeskConnectCard";
import { TrackingCarriersConnectCard } from "@/components/integrations/TrackingCarriersConnectCard";
import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { IntegrationsSuccessToast } from "@/components/integrations/IntegrationsSuccessToast";

export default async function IntegrationsPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/integrations");
  }

  return (
    <DashboardPageShell className="space-y-14">
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Sync with your e-commerce platform</h2>
          <p className="text-sm text-muted-foreground">
            Sync orders, customers, and inventory across your channels.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ShopifyConnectCard />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">3PL</h2>
          <p className="text-sm text-muted-foreground">
            Connect your logistics providers to keep shipping operations in sync.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WebshipperCard />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Carrier tracking</h2>
          <p className="text-sm text-muted-foreground">
            Choose which shipping carriers Sona should use for tracking lookups.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <TrackingCarriersConnectCard />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Unify customer conversations</h2>
          <p className="text-sm text-muted-foreground">
            Connect your helpdesk tools to Sona and get a complete overview of cases.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ZendeskConnectCard />
          <FreshdeskConnectCard />
          <GorgiasConnectCard />
        </div>
      </section>
      <IntegrationsSuccessToast />
    </DashboardPageShell>
  );
}
