import { redirect } from "next/navigation";

// The thank-you message now lives on the Satisfaction survey settings page.
export default function CsatThankYouSettingsPage() {
  redirect("/settings/customer-satisfaction");
}
