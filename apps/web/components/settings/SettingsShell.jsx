"use client";

import {
  Bot,
  Building2,
  CreditCard,
  Inbox,
  Mail,
  Star,
  Tag,
  User,
  Users2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV } from "@/lib/settings/navigation";

const SETTINGS_NAV_ICONS = {
  general: Building2,
  members: Users2,
  mailboxes: Inbox,
  tags: Tag,
  ai: Bot,
  automation: Zap,
  email: Mail,
  "customer-satisfaction": Star,
  profile: User,
  billing: CreditCard,
};

export function SettingsShell({ activeSection, onSelectSection, children }) {
  return (
    <main className="settings-theme flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:flex-row">
      <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:hidden">
        <span className="text-sm font-semibold text-foreground">Settings</span>
        <select
          aria-label="Settings section"
          value={activeSection}
          onChange={(event) => onSelectSection(event.target.value)}
          className="ml-auto h-9 min-w-0 max-w-[220px] rounded-md border border-input bg-background px-3 text-input md:text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          {SETTINGS_NAV.map((section) => (
            <optgroup key={section.label} label={section.label}>
              {section.items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <aside className="hidden h-full w-[224px] shrink-0 flex-col border-r border-border bg-background md:flex">
        <div className="px-5 pb-5 pt-8">
          <h1 className="text-page-heading font-semibold tracking-tight text-foreground">Settings</h1>
        </div>
        <nav aria-label="Settings navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {SETTINGS_NAV.map((section) => (
            <div key={section.label}>
              {section.label ? (
                <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {section.label}
                </p>
              ) : null}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = activeSection === item.key;
                  const Icon = SETTINGS_NAV_ICONS[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelectSection(item.key)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
                        active
                          ? "bg-accent font-semibold text-accent-foreground"
                          : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors duration-150",
                          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10 xl:px-14">
          <div className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
