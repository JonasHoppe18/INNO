import CsatResponseClient from "@/components/csat/CsatResponseClient";

export const dynamic = "force-dynamic";

export default async function CsatResponsePage({ params, searchParams }) {
  const routeParams = await params;
  const query = await searchParams;
  return <CsatResponseClient token={routeParams?.token || ""} initialScore={Number(query?.score)} />;
}
