"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RETURN_REASONS } from "@/lib/inbox/manual-actions";

const ACTION_TITLES = {
  update_shipping_address: "Update shipping address",
  cancel_order: "Cancel unfulfilled order",
  refund_order: "Refund order",
  initiate_return: "Start return",
};

const RETURN_REASON_LABELS = {
  COLOR: "Wrong color",
  DEFECTIVE: "Defective",
  NOT_AS_DESCRIBED: "Not as described",
  OTHER: "Other",
  SIZE_TOO_LARGE: "Size too large",
  SIZE_TOO_SMALL: "Size too small",
  STYLE: "Style",
  UNKNOWN: "Unknown",
  UNWANTED: "No longer wanted",
  WRONG_ITEM: "Wrong item",
};

function emptyFieldsForType(actionType, order) {
  if (actionType === "update_shipping_address") {
    return {
      name: order?.shippingAddress?.name || "",
      address1: order?.shippingAddress?.address1 || "",
      address2: order?.shippingAddress?.address2 || "",
      zip: order?.shippingAddress?.zip || "",
      city: order?.shippingAddress?.city || "",
      country: order?.shippingAddress?.country || "",
    };
  }
  if (actionType === "refund_order") {
    return { amount: order?.total || "", note: "" };
  }
  if (actionType === "initiate_return") {
    return { reason: "", note: "" };
  }
  return {};
}

export function ManualActionDialog({ actionType, order, threadId, onClose, onSubmitted }) {
  const [fields, setFields] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFields(emptyFieldsForType(actionType, order));
    setError("");
  }, [actionType, order]);

  const setField = (key) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const confirmLabel = useMemo(() => {
    if (actionType === "refund_order") {
      const amount = Number(fields?.amount);
      return Number.isFinite(amount) && amount > 0
        ? `Refund ${amount.toFixed(2)} ${order?.currency || ""}`.trim()
        : "Refund order";
    }
    if (actionType === "cancel_order") {
      return `Cancel order ${order?.id || ""}`.trim();
    }
    if (actionType === "update_shipping_address") return "Update address";
    if (actionType === "initiate_return") return "Start return";
    return "Confirm";
  }, [actionType, fields?.amount, order?.currency, order?.id]);

  if (!actionType) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/threads/${threadId}/actions/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          order: { id: order?.id, adminId: order?.adminId },
          formPayload: fields,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not start the action.");
      }
      onSubmitted?.(payload.action);
    } catch (submitError) {
      setError(submitError?.message || "Could not start the action.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ACTION_TITLES[actionType]}
            {order?.id ? ` — ${order.id}` : ""}
          </DialogTitle>
          <DialogDescription>This runs immediately against Shopify once you confirm.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {actionType === "update_shipping_address" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-name">Name</Label>
                <Input id="manual-address-name" value={fields.name || ""} onChange={setField("name")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-1">Address line 1</Label>
                <Input id="manual-address-1" value={fields.address1 || ""} onChange={setField("address1")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-2">Address line 2</Label>
                <Input id="manual-address-2" value={fields.address2 || ""} onChange={setField("address2")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-address-zip">Zip</Label>
                  <Input id="manual-address-zip" value={fields.zip || ""} onChange={setField("zip")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-address-city">City</Label>
                  <Input id="manual-address-city" value={fields.city || ""} onChange={setField("city")} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-country">Country</Label>
                <Input id="manual-address-country" value={fields.country || ""} onChange={setField("country")} />
              </div>
            </>
          ) : null}

          {actionType === "cancel_order" ? (
            <p className="text-sm text-muted-foreground">
              This cancels order {order?.id} in Shopify. Only unfulfilled orders can be cancelled.
            </p>
          ) : null}

          {actionType === "refund_order" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-refund-amount">Amount ({order?.currency || "order currency"})</Label>
                <Input
                  id="manual-refund-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={fields.amount ?? ""}
                  onChange={setField("amount")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-refund-note">Note (optional)</Label>
                <Textarea id="manual-refund-note" value={fields.note || ""} onChange={setField("note")} />
              </div>
            </>
          ) : null}

          {actionType === "initiate_return" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-return-reason">Reason</Label>
                <Select value={fields.reason || ""} onValueChange={setField("reason")}>
                  <SelectTrigger id="manual-return-reason">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {RETURN_REASON_LABELS[reason] || reason}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-return-note">Note (optional)</Label>
                <Textarea id="manual-return-note" value={fields.note || ""} onChange={setField("note")} />
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
