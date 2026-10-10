"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { ArrowUpRight, Loader2, Moon, Send, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TicketListItem } from "@/components/inbox/TicketListItem";
import { DashboardMockup } from "@/components/design/DashboardMockup";

const tickets = [
  { id: "demo-a", ticket_number: "1042", subject: "Where is my order?", is_local: true, has_ai_draft: true },
  { id: "demo-b", ticket_number: "1043", subject: "Exchange request", is_local: true },
  { id: "demo-c", ticket_number: "1044", subject: "Delivery options", is_local: true },
];

function DesignLabContent() {
  const { resolvedTheme, setTheme } = useTheme();
  const [selected, setSelected] = useState("demo-a");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <main className="design-typography mx-auto flex min-h-svh max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Badge variant="ai" className="w-fit">Local experiment</Badge>
          <h1 className="text-page-heading font-semibold tracking-tight">Sona design lab</h1>
          <p className="text-sm text-muted-foreground">Shared components with fictional data. No messages or settings are saved to Sona.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            {resolvedTheme === "dark" ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
            Switch theme
          </Button>
          <Button asChild><Link href="/inbox">Open inbox<ArrowUpRight data-icon="inline-end" /></Link></Button>
        </div>
      </header>
      <section aria-label="Typography scale" className="flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-page-heading">Page title · 16 px</p>
        <p className="text-base">Reading text · 14 px</p>
        <p className="text-sm">UI text · 13 px</p>
        <p className="text-xs text-muted-foreground">Metadata · 12 px</p>
      </section>
      <Tabs defaultValue="dashboard">
        <TabsList aria-label="Design examples">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="inbox">Inbox patterns</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-6">
          <DashboardMockup />
        </TabsContent>
        <TabsContent value="components" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle><CardDescription>One accent, neutral hover and visible keyboard focus.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button>Primary action</Button><Button variant="outline">Secondary</Button><Button variant="ghost">Toolbar action</Button>
                <Button disabled>Disabled</Button><Button disabled aria-busy="true"><Loader2 className="animate-spin" />Saving</Button>
                <Button variant="destructive">Delete</Button>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Preview dialog</DialogTitle><DialogDescription>This dialog uses the same tokens as the page and returns focus when it closes.</DialogDescription></DialogHeader>
                    <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={() => setDialogOpen(false)}>Done</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">Tab through the actions to compare focus, hover and disabled states.</p></CardFooter>
            </Card>
            <Card>
              <CardHeader><CardTitle>Status</CardTitle><CardDescription>Color describes state. Every badge keeps a text label.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Badge variant="info">Needs attention</Badge><Badge variant="neutral">Waiting on customer</Badge><Badge variant="warning">Waiting on third party</Badge>
                <Badge variant="success">Resolved</Badge><Badge variant="ai">Sona draft</Badge><Badge variant="danger">Send failed</Badge>
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">The same variants are used by the inbox status control.</p></CardFooter>
            </Card>
            <Card className="settings-theme">
              <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Settings inherits the app palette, including focus and popovers.</CardDescription></CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field><FieldLabel htmlFor="demo-invalid-email">Email with error</FieldLabel><Input id="demo-invalid-email" defaultValue="not-an-email" aria-invalid="true" aria-describedby="demo-email-error" /><p id="demo-email-error" className="text-xs text-destructive">Enter a valid email address.</p></Field>
                  <Field><FieldLabel htmlFor="demo-workspace">Workspace name</FieldLabel><Input id="demo-workspace" defaultValue="Demo workspace" /></Field>
                  <Field><FieldLabel htmlFor="demo-shop">Shop</FieldLabel><Select defaultValue="demo"><SelectTrigger id="demo-shop"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="demo">Demo store</SelectItem><SelectItem value="other">Another demo store</SelectItem></SelectGroup></SelectContent></Select></Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-between gap-4"><p role="status" className="text-sm text-muted-foreground">{saved ? "Saved in this preview only." : "Fictional workspace."}</p><Button onClick={() => setSaved(true)}>Save preview</Button></CardFooter>
            </Card>
            <Card>
              <CardHeader><CardTitle>Customers / knowledge</CardTitle><CardDescription>Neutral hover and the same accent for selected rows.</CardDescription></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody><TableRow data-state="selected"><TableCell>Demo customer A</TableCell><TableCell><Badge variant="info">Needs attention</Badge></TableCell></TableRow><TableRow><TableCell>Demo customer B</TableCell><TableCell><Badge variant="success">Resolved</Badge></TableCell></TableRow></TableBody>
                </Table>
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">Existing table dimensions and component composition are retained.</p></CardFooter>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="inbox" className="mt-6">
          <div className="grid overflow-hidden rounded-xl border bg-card md:grid-cols-[300px_1fr]">
            <section aria-label="Demo conversation list" className="divide-y border-b md:border-b-0 md:border-r">
              <h2 className="px-3 py-4 text-section-heading font-semibold">Demo conversations</h2>
              {tickets.map((ticket, index) => <TicketListItem key={ticket.id} thread={ticket} customerLabel={`Demo customer ${index + 1}`} timestamp="2026-10-02T08:00:00Z" isActive={selected === ticket.id} unreadCount={index === 0 ? 1 : 0} onSelect={() => setSelected(ticket.id)} />)}
            </section>
            <section className="flex min-w-0 flex-col gap-6 bg-background p-6" aria-label="Demo conversation">
              <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">{tickets.find((ticket) => ticket.id === selected)?.subject}</h2><Badge variant="info">Needs attention</Badge></div>
              <div className="rounded-xl border bg-card p-4 text-sm leading-6">Hi! Could you help me check the delivery for my demo order?</div>
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <Badge variant="ai" className="w-fit">Sona draft</Badge>
                <Field><FieldLabel htmlFor="demo-reply">Reply preview</FieldLabel><Textarea id="demo-reply" defaultValue="Hi! I can help you check the delivery. This is a fictional draft for comparing the colors." /></Field>
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">No email is sent from this preview.</span><Button disabled size="icon" className="rounded-full" aria-label="Send preview unavailable"><Send /></Button></div>
              </div>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}

export function DesignLab() {
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="sona-design-lab-theme"><DesignLabContent /></ThemeProvider>;
}
