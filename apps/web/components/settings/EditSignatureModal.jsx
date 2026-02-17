"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

function getDisplayName(member) {
  const first = String(member?.first_name || "").trim();
  const last = String(member?.last_name || "").trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  const email = String(member?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Member";
}

export function EditSignatureModal({
  open,
  onOpenChange,
  member,
  onSaved,
}) {
  const supabase = useClerkSupabase();
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSignature(String(member?.signature || ""));
  }, [member?.signature, open]);

  const previewSignature = useMemo(() => {
    const value = String(signature || "").trim();
    return value || "Best regards,\nSona Team";
  }, [signature]);

  const handleSave = async () => {
    if (!supabase || !member?.user_id || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ signature: String(signature || "").trim() || null })
        .eq("user_id", member.user_id);

      if (error) throw error;

      onSaved?.(member.user_id, String(signature || "").trim());
      toast.success("Signature updated.");
      onOpenChange(false);
    } catch (error) {
      if (error?.code === "42703") {
        toast.error("profiles.signature column is missing.");
      } else {
        toast.error(error?.message || "Could not update signature.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-gray-200 bg-white">
        <DialogHeader>
          <DialogTitle>Edit Email Signature</DialogTitle>
          <DialogDescription>
            Update signature for {getDisplayName(member)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="member-signature" className="text-sm font-medium text-slate-700">
              Signature
            </label>
            <Textarea
              id="member-signature"
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={"Best regards,\nYour Name"}
              className="min-h-[150px] resize-y border-gray-200"
            />
          </div>

          <div className="rounded-lg bg-gray-100 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Live Preview
            </p>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-slate-700">
              <div className="-m-4 mb-4 rounded-t-lg border-b border-gray-200 bg-gray-50 p-4 text-gray-700">
                <p>
                  <span className="font-semibold">From:</span> Sona Support{" "}
                  <span className="text-gray-500">&lt;support@yourcompany.com&gt;</span>
                </p>
                <p>
                  <span className="font-semibold">To:</span>{" "}
                  <span className="text-gray-600">customer@example.com</span>
                </p>
                <p>
                  <span className="font-semibold">Subject:</span>{" "}
                  <span className="text-gray-600">Re: Your inquiry</span>
                </p>
              </div>

              <p>Hi Customer, thanks for reaching out...</p>
              <p className="mt-4 whitespace-pre-line">{previewSignature}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            {saving ? "Saving..." : "Save Signature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
