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
    // {
    //   name: "Persona",
    //   url: "/persona",
    //   icon: UserRoundPenIcon,
    // },
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

  const isAllTicketsActive = pathname === "/inbox" && !view
  const isAssignedActive = pathname === "/inbox" && view === "mine"
  const isResolvedActive = pathname === "/inbox" && view === "resolved"

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden pt-0">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          INBOXES
        </span>
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

      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <Link
              href="/inbox"
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100",
                isAllTicketsActive && "bg-slate-100 text-slate-900"
              )}
            >
              <Inbox className="h-4 w-4 shrink-0" />
              <span>All Tickets</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsInboxOpen((prev) => !prev)
                }}
                className="ml-auto rounded p-0.5 hover:bg-slate-200"
              >
                {isInboxOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span className="sr-only">Toggle inbox filters</span>
              </button>
            </Link>
          </SidebarMenuItem>

          {isInboxOpen ? (
            <>
              <SidebarMenuItem>
                <Link
                  href="/inbox?view=mine"
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 pl-8 text-sm text-slate-600 hover:bg-slate-100",
                    isAssignedActive && "bg-slate-100 text-slate-900"
                  )}
                >
                  <User className="h-4 w-4 shrink-0" />
                  <span>Assigned to me</span>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link
                  href="/inbox?view=resolved"
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 pl-8 text-sm text-slate-600 hover:bg-slate-100",
                    isResolvedActive && "bg-slate-100 text-slate-900"
                  )}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Resolved</span>
                </Link>
              </SidebarMenuItem>
            </>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
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
