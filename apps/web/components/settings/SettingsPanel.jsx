"use client";

import { useState } from "react";
import { Building2, User, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MENU_SECTIONS = [
  {
    label: "PERSONAL",
    items: [{ key: "profile", label: "Profile", icon: User }],
  },
  {
    label: "TEAM",
    items: [
      { key: "general", label: "General", icon: Building2 },
      { key: "members", label: "Members", icon: Users2 },
    ],
  },
];

const CONTENT_COPY = {
  profile: "Manage your personal profile information.",
  general: "Configure shared team settings.",
  members: "Invite and manage team members.",
};

export function SettingsPanel() {
  const [activeKey, setActiveKey] = useState("general");

  return (
    <main className="bg-white px-4 py-6 lg:px-10 lg:py-10">
      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-7">
          {MENU_SECTIONS.map((section) => (
            <div key={section.label} className="space-y-2">
              <h3 className="px-2 text-xs font-semibold tracking-[0.12em] text-slate-500">
                {section.label}
              </h3>
              <nav className="space-y-1">
                {section.items.map((item) => {
                  const active = activeKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveKey(item.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-base text-slate-600 hover:bg-slate-100",
                        active && "bg-slate-100 font-medium text-slate-900"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </aside>

        <section className="rounded-lg bg-white p-6">
          <h2 className="text-2xl font-semibold text-slate-900 capitalize">{activeKey}</h2>
          <p className="mt-2 text-sm text-slate-600">{CONTENT_COPY[activeKey]}</p>
        </section>
      </div>
    </main>
  );
}
