"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  BookOpenIcon,
  BotIcon,
  CableIcon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircleIcon,
  Inbox,
  LayoutDashboardIcon,
  MailIcon,
  Plus,
  User,
  UserRoundPenIcon,
} from "lucide-react"

import { NavAgent } from "@/components/nav-agent"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

import { SonaLogo } from "@/components/ui/SonaLogo"

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
  ],
  agent: [
    {
      name: "Mailboxes",
      url: "/mailboxes",
      icon: MailIcon,
    },
    {
      name: "Persona",
      url: "/persona",
      icon: UserRoundPenIcon,
    },
    {
      name: "Automation",
      url: "/automation",
      icon: BotIcon,
    },
    {
      name: "Policies",
      url: "/knowledge",
      icon: BookOpenIcon,
    },
  ],
}

function InboxSection({ isInboxOpen, setIsInboxOpen, handleCreateInbox }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get("view")

  const inboxItems = [
    {
      title: "All Tickets",
      url: "/inbox",
      icon: Inbox,
      isActive: pathname === "/inbox" && !view,
    },
    {
      title: "Assigned to me",
      url: "/inbox?view=mine",
      icon: User,
      isActive: pathname === "/inbox" && view === "mine",
    },
    {
      title: "Resolved",
      url: "/inbox?view=resolved",
      icon: CheckCircle2,
      isActive: pathname === "/inbox" && view === "resolved",
    },
  ]

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden pt-0">
      <div className="mb-1 flex items-center justify-between px-2">
        <button
          type="button"
          onClick={() => setIsInboxOpen((prev) => !prev)}
          className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500"
        >
          {isInboxOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span>INBOXES</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleCreateInbox()
          }}
          className="cursor-pointer rounded p-0.5 text-slate-600 hover:bg-slate-200"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="sr-only">Create inbox</span>
        </button>
      </div>

      {isInboxOpen && (
        <SidebarGroupContent>
          <SidebarMenu>
            {inboxItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <Link
                  href={item.url}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100",
                    item.isActive && "bg-slate-100 text-slate-900"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

export function AppSidebar({
  user,
  ...props
}) {
  const [isInboxOpen, setIsInboxOpen] = useState(true)

  const handleCreateInbox = () => {
    console.log("Create inbox clicked")
  }

  const data = {
    ...baseData,
    user: user ?? baseData.user,
  }

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
        <InboxSection
          isInboxOpen={isInboxOpen}
          setIsInboxOpen={setIsInboxOpen}
          handleCreateInbox={handleCreateInbox}
        />
        <NavAgent items={data.agent} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
