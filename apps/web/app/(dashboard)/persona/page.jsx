import { redirect } from "next/navigation";

// The agent's master prompt is now edited on the Settings page (the canonical
// editor — see the "AI Prompt" section). This route stays as a redirect so any
// existing links/bookmarks land in the right place.
export default function AgentPersonaPage() {
  redirect("/settings");
}
