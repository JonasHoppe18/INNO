"use client";

import { createContext, useContext } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Shared building blocks for every settings section. Sections compose these
// instead of styling their own cards, headings and rows.

export function SettingsPage({ title, description, actions = null, width = "form", children }) {
  return (
    <section className={cn("mx-auto w-full pb-24", width === "wide" ? "max-w-[960px]" : "max-w-[720px]")}>
      <header className="mb-6 flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-page-heading font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-9">{children}</div>
    </section>
  );
}

export function SettingsGroup({ title, description, action = null, footer = null, children }) {
  return (
    <section>
      {title || description || action ? (
        <div className="mb-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-section-heading font-semibold text-foreground">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="divide-y divide-border/60">{children}</div>
      {footer ? <div className="mt-2 text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

export function SettingsRow({ label, description, htmlFor, stacked = false, children, controlClassName }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 py-3.5",
        !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-8"
      )}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div
        className={cn(
          "flex items-center",
          stacked ? "w-full" : "shrink-0 sm:w-64 sm:justify-end",
          controlClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

const TableTemplateContext = createContext("1fr");

export function SettingsTable({ columns, template, minWidth = 640, children }) {
  return (
    <TableTemplateContext.Provider value={template}>
      <div className="overflow-x-auto">
        <div role="table" style={{ minWidth }}>
          <div
            role="row"
            className="grid items-center gap-4 border-b border-border/60 pb-2 pt-1 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((column) => (
              <div key={column.key} role="columnheader" className={cn(column.align === "right" && "text-right")}>
                {column.label}
              </div>
            ))}
          </div>
          <div className="divide-y divide-border/60">{children}</div>
        </div>
      </div>
    </TableTemplateContext.Provider>
  );
}

export function SettingsTableRow({ muted = false, children }) {
  const template = useContext(TableTemplateContext);
  return (
    <div
      role="row"
      className={cn("grid items-center gap-4 py-3 text-sm", muted && "text-muted-foreground")}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function SettingsRowMenu({ label = "More actions", disabled = false, title, children }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
          disabled={disabled}
          title={title}
          aria-label={label}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsEmptyState({ title, description, action = null }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function SettingsTabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="-mt-2 flex gap-5 overflow-x-auto border-b border-border/60">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              "-mb-px shrink-0 border-b-2 pb-2 text-sm transition-colors duration-150",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsSwitch({ className, ...props }) {
  return (
    <Switch
      className={cn("data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/25 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}

// Floating bar for form sections; appears only while there are unsaved changes.
export function SettingsSaveBar({ visible, saving = false, onSave, onDiscard }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none sticky bottom-5 z-20 flex justify-center">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-[0_4px_16px_hsl(var(--foreground)/0.06),0_1px_3px_hsl(var(--foreground)/0.04)]"
      >
        <span className="text-sm text-muted-foreground">Unsaved changes</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
