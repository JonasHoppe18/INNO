"use client"

import * as React from "react"
import {
  ArrowUpCircleIcon,
  BookOpenIcon,
  BotIcon,
  CableIcon,
  ClipboardListIcon,
  FileIcon,
  HeartHandshake,
  HelpCircleIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MailIcon,
  SearchIcon,
  SettingsIcon,
  UserRoundPenIcon,
  WorkflowIcon,
  HeartHandshakeIcon,
  DocumentIcon,
} from "lucide-react"

import { NavNewsletter } from "@/components/nav-newsletter"
import { NavAgent } from "@/components/nav-agent"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { SignOutButton } from "@clerk/nextjs"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

import { SonaLogo } from "@/components/ui/SonaLogo"

// Dummy data så hele TailArk sidebar-komponenten kan vises i Next.
const baseData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
    {
      title: "Inbox",
      url: "/inbox",
      icon: InboxIcon,
    },
    {
      title: "Mailboxes",
      url: "/mailboxes",
      icon: MailIcon,
    },
  ],
  navSecondary: [
    {
      title: "Integrations",
      url: "/integrations",
      icon: CableIcon,
    },
    {
      title: "Guides",
      url: "/guides",
      icon: HelpCircleIcon,
    },
    {
      title: "Settings",
      url: "#",
      icon: SettingsIcon,
    },
  ],
  agent: [
     {
          name: "Persona",
          url: "/persona",
          icon: UserRoundPenIcon,

        },
        {
          name: "Automation",
          url: "/automation",
          icon: BotIcon
        },
        {
          name: "Policies",
          url: "/knowledge",
          icon: BookOpenIcon,
        },
  ],
  newsletter: [
    {
      name: "Campaigns",
      url: "/marketing/campaigns",
      icon: ClipboardListIcon,
    },
    {
      name: "Retention Flows",
      url: "/marketing/retention-flows",
      icon: HeartHandshakeIcon,
    }
  ],
}

export function AppSidebar({
  user,
  ...props
}) {
  const data = {
    ...baseData,
    user: user ?? baseData.user,
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <a href="#">
                <SonaLogo size={24} className="h-4 w-4" />
                <span className="text-base font-semibold">Sona AI</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavAgent items={data.agent} />
        <NavNewsletter items={data.newsletter} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
