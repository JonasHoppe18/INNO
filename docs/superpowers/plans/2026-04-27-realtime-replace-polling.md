# Realtime Replace Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fjern det periodiske polling-loop i inbox og erstat det med Supabase Realtime + én initial load + reconnect re-fetch.

**Architecture:** `InboxSplitView.jsx` henter data én gang ved mount via `/api/inbox/live`. Derefter håndterer eksisterende `postgres_changes`-subscriptions alle opdateringer. Ved Realtime-reconnect eller tab-focus hentes data igen (med 30s debounce) for at fange events der er gået tabt under en disconnect.

**Tech Stack:** React hooks, Supabase Realtime (`postgres_changes`), Next.js App Router, `/api/inbox/live` REST endpoint.

---

## Kontekst og nuværende arkitektur

**Fil der ændres:** `apps/web/components/inbox/InboxSplitView.jsx`

**State:**
- `liveThreads`, `liveMessages`, `liveAttachments` — state der drives af polling + realtime
- `refreshInboxDataRef` — ref der eksponerer `refreshInboxData` til realtime-handlers

**Eksisterende subscriptions (lines 1035–1171):**
- Channel `inbox-thread-updates:{user.id}`: lytter på INSERT/UPDATE/DELETE på `mail_threads`
- Channel `inbox-message-updates:{user.id}`: lytter på INSERT/UPDATE på `mail_messages` + INSERT på `mail_attachments`
- Ved INSERT på `mail_threads` kaldes `refreshInboxDataRef.current?.()` for at re-sortere listen

**Polling-loop (lines 932–1033):**
- Kører `/api/inbox/live` hvert 45s
- `scheduleNext(0)` ved mount — dvs. første fetch er øjeblikkelig
- Exponential backoff ved fejl
- `onFocus` trigger ved tab-focus

**Plan:** Behold den logik der virker, fjern kun timeren. Ny version: initial load + focus re-fetch + reconnect re-fetch (alle med 30s debounce).

---

## Task 1: Erstat polling-loop med initial load + on-demand fetch

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (lines 932–1033)

- [ ] **Step 1: Erstat hele polling-useEffect-blokken**

Find denne blok (lines 932–1033):
```js
useEffect(() => {
  let active = true;
  let polling = false;
  let timerId = null;
  let consecutiveFailures = 0;

  const BASE_POLL_MS = 45_000;
  // ... hele blokken til og med ...
}, []);
```

Erstat den med:
```js
useEffect(() => {
  let active = true;
  let lastFetchAt = 0;
  const REFETCH_COOLDOWN_MS = 30_000;

  const fetchInboxData = async () => {
    if (!active) return;
    if (Date.now() - lastFetchAt < REFETCH_COOLDOWN_MS) return;
    lastFetchAt = Date.now();
    try {
      const response = await fetch("/api/inbox/live", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok || !active) return;
      const payload = await response.json().catch(() => null);
      if (!active) return;
      const threadRows = Array.isArray(payload?.threads) ? payload.threads : [];
      const messageRows = Array.isArray(payload?.messages) ? payload.messages : [];
      const attachmentRows = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (threadRows.length > 0) setLiveThreads(threadRows);
      if (messageRows.length > 0) setLiveMessages(messageRows);
      if (attachmentRows.length > 0) setLiveAttachments(attachmentRows);
    } catch {
      // realtime handles ongoing updates — no retry loop needed
    }
  };

  // Initial load
  fetchInboxData();

  // Re-fetch on focus so stale data after a long idle gets refreshed
  const onFocus = () => {
    if (!active) return;
    fetchInboxData();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onFocus);
  }

  refreshInboxDataRef.current = fetchInboxData;

  return () => {
    active = false;
    refreshInboxDataRef.current = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onFocus);
    }
  };
}, []);
```

- [ ] **Step 2: Verificer at appen starter korrekt**

```bash
cd /Users/jonashoppe/Developer/INNO
npm run dev
```

Åbn inbox i browser. Tjek at:
- Tråde loader ved mount
- Ingen periodiske netværkskald til `/api/inbox/live` (tjek Network-tab — der må kun komme ét kald ved load, og ét ved focus)

- [ ] **Step 3: Commit**

```bash
cd /Users/jonashoppe/Developer/INNO
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "perf: replace polling loop with single initial load + focus re-fetch"
```

---

## Task 2: Tilføj reconnect re-fetch til Realtime-subscriptions

Når Supabase Realtime reconnecter (fx efter netværksudfald), vil vi hente friske data for at fange events der gik tabt. Supabase kalder `subscribe(callback)` med status `"SUBSCRIBED"` ved (re)connect.

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (lines 1055–1086 og 1100–1161)

- [ ] **Step 1: Tilføj reconnect-handler til thread-channel**

Find denne linje (ca. line 1086):
```js
      .subscribe();
```
(Det er den `.subscribe()` der tilhører `inbox-thread-updates`-channel)

Den er efter `.on(DELETE ...)` blokken. Erstat `.subscribe()` med:
```js
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Re-fetch after reconnect to catch events missed during disconnect
          refreshInboxDataRef.current?.();
        }
      });
```

- [ ] **Step 2: Tilføj reconnect-handler til message-channel**

Find den anden `.subscribe()` (ca. line 1161 — den der tilhører `inbox-message-updates`-channel):
```js
      .subscribe();
```

Erstat med:
```js
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          refreshInboxDataRef.current?.();
        }
      });
```

- [ ] **Step 3: Verificer reconnect-adfærd**

```bash
npm run dev
```

I browser: åbn inbox, åbn DevTools → Network. Slå netværket fra i 5 sekunder (DevTools → Network → Offline), slå det til igen. Forvent: ét kald til `/api/inbox/live` kort efter reconnect.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonashoppe/Developer/INNO
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "perf: re-fetch inbox data on realtime reconnect to catch missed events"
```

---

## Task 3: Tilføj user_id-filter til postgres_changes subscriptions

Uden filter sender Supabase en RLS-check per subscriber per DB-change. Med `user_id`-filter broadcast Supabase kun til subscriptions der matcher — ingen RLS-overhead.

`currentSupabaseUserId` (Supabase UUID) er allerede tilgængeligt i komponenten. Subscriptions skal kun oprettes når den er klar.

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (lines 1035–1096 og 1098–1171)

- [ ] **Step 1: Opdater dependency array for thread-subscription**

Find:
```js
  }, [supabase, user?.id]);
```
(Den der afslutter thread-channel useEffect, ca. line 1096)

Erstat med:
```js
  }, [supabase, user?.id, currentSupabaseUserId]);
```

Og tilføj et early return øverst i useEffect hvis `currentSupabaseUserId` ikke er klar endnu:
```js
  useEffect(() => {
    if (!supabase || !user?.id || !currentSupabaseUserId) return;
```
(Erstat den eksisterende `if (!supabase || !user?.id) return;`)

- [ ] **Step 2: Tilføj filter til thread INSERT og UPDATE subscriptions**

Find (ca. line 1057–1072):
```js
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mail_threads" },
```

Erstat begge `.on()` kald (INSERT og UPDATE — ikke DELETE, der kender vi kun old.id) med:
```js
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mail_threads", filter: `user_id=eq.${currentSupabaseUserId}` },
```
```js
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mail_threads", filter: `user_id=eq.${currentSupabaseUserId}` },
```

DELETE-eventet behold ufiltreret (vi kender kun `old.id`, og det er ufarligt at modtage for andre threads — state-tjekket `if (!existing.length) return existing` beskytter).

- [ ] **Step 3: Opdater message-subscription på samme måde**

Find (ca. line 1098):
```js
  useEffect(() => {
    if (!supabase || !user?.id) return;
```

Erstat med:
```js
  useEffect(() => {
    if (!supabase || !user?.id || !currentSupabaseUserId) return;
```

Opdater dependency array for message-channel (ca. line 1171):
```js
  }, [supabase, user?.id]);
```
→
```js
  }, [supabase, user?.id, currentSupabaseUserId]);
```

Tilføj filter på INSERT og UPDATE for `mail_messages`:
```js
        { event: "INSERT", schema: "public", table: "mail_messages", filter: `user_id=eq.${currentSupabaseUserId}` },
```
```js
        { event: "UPDATE", schema: "public", table: "mail_messages", filter: `user_id=eq.${currentSupabaseUserId}` },
```

`mail_attachments` INSERT beholdes ufiltreret (ingen `user_id` kolonne garanti).

- [ ] **Step 4: Verificer at subscriptions stadig modtager events**

```bash
npm run dev
```

Send en test-email ind til systemet (eller opret en tråd manuelt). Verificer at:
- Ny tråd dukker op i inbox uden page reload
- `currentSupabaseUserId` er sat (tjek via React DevTools eller console.log)

- [ ] **Step 5: Commit**

```bash
cd /Users/jonashoppe/Developer/INNO
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "perf: add user_id filter to postgres_changes subscriptions to reduce RLS overhead"
```

---

## Verificering end-to-end

1. Åbn inbox — tråde loader normalt ved mount
2. Åbn Network-tab — ingen periodiske kald til `/api/inbox/live` efter initial load
3. Modtag en ny email — tråd dukker op live via Realtime uden reload
4. Gå offline i 10s, kom online — ét kald til `/api/inbox/live` vises i Network-tab
5. Skift tab, kom tilbage — ét kald til `/api/inbox/live` (med 30s debounce)
6. Tjek Supabase Dashboard → Infrastructure → Disk IO efter 24 timer — burde falde markant
