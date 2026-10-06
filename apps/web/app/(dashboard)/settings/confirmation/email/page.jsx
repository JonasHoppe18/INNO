import { ConfirmationEmailBuilder } from "@/components/confirmation/ConfirmationEmailBuilder";
export default function ConfirmationEmailPage({ searchParams }) {
  const mailboxId =
    typeof searchParams?.mailbox_id === "string" ? searchParams.mailbox_id : "";
  return <ConfirmationEmailBuilder mailboxId={mailboxId} />;
}
