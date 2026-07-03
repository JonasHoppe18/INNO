import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const supabase = createClient(url, key);
const MARKER = `lifecycle-tick-test-${Date.now()}`;

async function main() {
  // mail_threads requires a real user_id + mailbox_id (FK to auth.users /
  // mail_accounts), so borrow an existing mailbox row for those fields.
  const { data: mailbox, error: mbErr } = await supabase
    .from("mail_accounts")
    .select("id, user_id")
    .limit(1)
    .single();
  if (mbErr) throw mbErr;

  // Seed: a throwaway workspace carries the auto-close config under test.
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .insert({ name: MARKER, auto_close_days: 2, auto_close_mode: "approve" })
    .select("id")
    .single();
  if (wsErr) throw wsErr;

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const base = {
    workspace_id: ws.id,
    user_id: mailbox.user_id,
    mailbox_id: mailbox.id,
    provider: "smtp",
    subject: MARKER,
  };
  const { data: threads, error: thErr } = await supabase
    .from("mail_threads")
    .insert([
      { ...base, status: "waiting_third_party", waiting_reason: "third_party", wake_at: daysAgo(1), status_changed_at: daysAgo(5) },
      { ...base, status: "waiting_customer", waiting_reason: "customer", status_changed_at: daysAgo(3) },
      { ...base, status: "waiting_customer", waiting_reason: "customer", status_changed_at: daysAgo(1) },
    ])
    .select("id");
  if (thErr) throw thErr;

  let failed = false;
  try {
    const { error: rpcErr } = await supabase.rpc("tick_thread_lifecycle");
    if (rpcErr) throw rpcErr;

    const { data: after, error: afterErr } = await supabase
      .from("mail_threads")
      .select("id, status, attention_reason, close_pending, wake_at")
      .in("id", threads.map((t) => t.id))
      .order("created_at");
    if (afterErr) throw afterErr;

    const [woken, closeDue, notDue] = after;
    const checks = [
      ["wake-due thread woke", woken.status === "needs_attention" && woken.attention_reason === "wake_timer" && woken.wake_at === null],
      ["silent thread flagged for approve-close", closeDue.status === "waiting_customer" && closeDue.close_pending === true && closeDue.attention_reason === "approve_close"],
      ["fresh waiting thread untouched", notDue.status === "waiting_customer" && notDue.close_pending === false],
    ];
    for (const [name, ok] of checks) {
      console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
      if (!ok) failed = true;
    }
  } finally {
    // Cleanup: always remove seeded data, even if the body threw.
    await supabase.from("mail_threads").delete().in("id", threads.map((t) => t.id));
    await supabase.from("workspaces").delete().eq("id", ws.id);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
