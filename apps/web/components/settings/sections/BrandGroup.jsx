"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsGroup, SettingsRow } from "@/components/settings/ui/settings-layout";

const DEFAULT_PICKER_COLOR = "#4f46e5";

export function BrandGroup({ brand, onChange, disabled = false }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/settings/brand/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) throw new Error(payload?.error || "Could not upload logo.");
      onChange({ ...brand, logoUrl: payload.url });
    } catch (error) {
      toast.error(error?.message || "Could not upload logo.");
    } finally {
      setUploading(false);
    }
  };

  const pickerColor = /^#[0-9a-f]{6}$/i.test(brand.accentColor) ? brand.accentColor : DEFAULT_PICKER_COLOR;

  return (
    <SettingsGroup title="Brand" description="Used in your confirmation and satisfaction email designs.">
      <SettingsRow label="Logo" description="PNG or JPG, up to 5 MB.">
        <div className="flex items-center gap-2">
          {brand.logoUrl ? (
            <span className="flex h-8 max-w-28 items-center rounded-md border border-border/70 bg-background px-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt="Brand logo" className="max-h-6 max-w-full object-contain" />
            </span>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Uploading…" : brand.logoUrl ? "Replace" : "Upload"}
          </Button>
          {brand.logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              disabled={disabled || uploading}
              onClick={() => onChange({ ...brand, logoUrl: "" })}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow label="Accent color" description="Used for headlines, links and buttons." htmlFor="settings-brand-accent">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <input
            type="color"
            aria-label="Pick accent color"
            value={pickerColor}
            onChange={(event) => onChange({ ...brand, accentColor: event.target.value.toLowerCase() })}
            disabled={disabled}
            className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border/70 bg-background p-0.5"
          />
          <Input
            id="settings-brand-accent"
            value={brand.accentColor}
            onChange={(event) => onChange({ ...brand, accentColor: event.target.value.trim() })}
            placeholder="#4f46e5"
            maxLength={7}
            className="h-8 w-28 font-mono text-input text-foreground md:text-sm"
            disabled={disabled}
          />
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
