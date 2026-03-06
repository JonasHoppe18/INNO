import { redirect } from "next/navigation";

export default async function LegacyGuideRedirectPage({ params }) {
  redirect(`/guide/${params.slug}`);
}
