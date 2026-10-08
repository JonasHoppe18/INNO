import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import {
  legacySettingsPath,
  parseSettingsSlug,
  settingsPath,
  withSearchParams,
} from "@/lib/settings/navigation";

export default async function SettingsPage({ params, searchParams }) {
  const { userId } = await auth();
  const slug = Array.isArray(params?.slug) ? params.slug : [];
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(["/settings", ...slug].join("/"))}`);
  }
  if (!slug.length) {
    redirect(searchParams?.tab ? legacySettingsPath(searchParams) : settingsPath("general"));
  }
  const route = parseSettingsSlug(slug);
  if (!route) redirect(settingsPath("general"));
  const canonical = settingsPath(route.section, route.emailSection);
  if (`/settings/${slug.join("/")}` !== canonical) redirect(withSearchParams(canonical, searchParams));

  return <SettingsWorkspace />;
}
