// Read-only browser probe. Outputs durations and assertions, never message bodies.
const fs = require("node:fs");
const { createRequire } = require("node:module");
createRequire(process.cwd() + "/package.json")("@next/env").loadEnvConfig(process.cwd() + "/apps/web");
const { chromium } = require(process.env.PERF_PLAYWRIGHT_PATH || "/tmp/sona-performance-browser/node_modules/playwright");
const output = process.env.PERF_OUTPUT_FILE || "/tmp/sona-conversation-visible.json";
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PERF_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const results = [];
  for (const version of ["after"]) {
    const base = version === "before" ? (process.env.PERF_BEFORE_URL || "http://localhost:3108") : (process.env.PERF_AFTER_URL || "http://localhost:3107");
    const context = await browser.newContext({ viewport: { width: 1470, height: 900 } });
    const login = await context.newPage();
    await login.goto(base + "/inbox");
    await login.locator("input[name=identifier]").fill(process.env.DEV_LOGIN_EMAIL);
    await login.locator("input[name=password]").fill(process.env.DEV_LOGIN_PASSWORD);
    await login.locator("input[name=password]").press("Enter");
    await login.waitForURL(url => url.pathname !== "/sign-in", { timeout: 30000 });
    await login.locator('button[draggable="true"]').first().waitFor({ timeout: 30000 });
    await login.close();
    let blockedWrites = 0;
    await context.route("**/*", async route => {
      const request = route.request();
      if ((request.url().startsWith(base + "/api/") || request.url().includes("zxaoycxzdjrbnzvbullk.supabase.co/rest/")) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        blockedWrites++;
        await route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Writes disabled during performance probe"}' });
      } else await route.continue();
    });
    for (const scenario of ["cold_click"]) {
      const samples = [];
      for (let round = 0; round < 3; round++) {
        await context.clearCookies({ name: "sona-selected-thread" });
        const page = await context.newPage();
        await page.goto(base + "/inbox");
        const rows = page.locator('button[draggable="true"]');
        await rows.nth(round + 1).waitFor({ timeout: 30000 });
        await page.waitForTimeout(1000);
        const row = rows.nth(round + 1);
        const responsePending = page.waitForResponse(response => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(response.url()).pathname) && !new URL(response.url()).search && response.request().method() === "GET");
        await page.evaluate(() => {
          window.__conversationTiming = { start: performance.now(), visibleMs: null };
          const observer = new MutationObserver(() => {
            if (document.querySelector('[class~="group/bubble"]') && window.__conversationTiming.visibleMs === null) {
              window.__conversationTiming.visibleMs = performance.now() - window.__conversationTiming.start;
              observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        const start = Date.now();
        if (scenario === "hover_prefetch") await row.hover();
        else await row.evaluate(element => element.click());
        const response = await responsePending;
        const payload = await response.json();
        const dataMs = Date.now() - start;
        if (response.status() !== 200 || !Array.isArray(payload.messages)) throw new Error("Thread detail failed.");
        if (scenario === "hover_prefetch") await row.evaluate(element => element.click());
        await page.waitForTimeout(300);
        const selectedId = new URL(page.url()).searchParams.get("thread");
        const responseId = new URL(response.url()).pathname.split("/")[4];
        const belongsToSelection = selectedId === responseId && payload.messages.every(message => message.thread_id === selectedId);
        if (!belongsToSelection) throw new Error("Selected thread and returned messages do not match.");
        const visibleMs = await page.evaluate(() => Math.round(window.__conversationTiming.visibleMs));
        const expected = await page.locator('[class~="group/bubble"]').first().textContent();
        const originalId = selectedId;
        const other = rows.nth(round + 5);
        const otherResponse = page.waitForResponse(response => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(response.url()).pathname) && !new URL(response.url()).search);
        await other.evaluate(element => element.click()); await (await otherResponse).finished();
        await page.waitForTimeout(250);
        await page.evaluate(({ expected, originalId }) => {
          window.__cachedTiming = { start: performance.now(), visibleMs: null };
          const check = () => {
            const bubble = document.querySelector('[class~="group/bubble"]');
            if (new URL(location.href).searchParams.get("thread") === originalId && bubble?.textContent === expected && window.__cachedTiming.visibleMs === null) {
              window.__cachedTiming.visibleMs = performance.now() - window.__cachedTiming.start;
              observer.disconnect();
            }
          };
          const observer = new MutationObserver(check); observer.observe(document.body, { childList: true, subtree: true });
        }, { expected, originalId });
        const freshResponse = page.waitForResponse(response => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(response.url()).pathname) && !new URL(response.url()).search);
        await row.evaluate(element => element.click()); await (await freshResponse).finished();
        await page.waitForTimeout(150);
        const cachedVisibleMs = await page.evaluate(() => Math.round(window.__cachedTiming.visibleMs));
        if (!cachedVisibleMs) throw new Error("Cached conversation did not render.");
        samples.push({ visibleMs, cachedVisibleMs, dataMs, status: response.status(), belongsToSelection });
        await page.close();
      }
      results.push({ version, scenario, samples });
    }
    const page = await context.newPage();
    await page.goto(base + "/inbox");
    await page.locator('button[draggable="true"]').first().waitFor();
    await page.waitForTimeout(1000);
    let rscReads = 0;
    page.on("request", request => { if (request.headers().rsc === "1") rscReads++; });
    const hoverRow = page.locator('button[draggable="true"]').nth(9);
    let fullRequests = 0;
    page.on("request", request => {
      const url = new URL(request.url());
      if (/\/api\/inbox\/threads\/[^/]+\/detail$/.test(url.pathname) && !url.search) fullRequests++;
    });
    await page.route("**/api/inbox/threads/*/detail", async route => {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ response });
    });
    const fullStarted = page.waitForRequest(request => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(request.url()).pathname) && !new URL(request.url()).search);
    const completed = page.waitForResponse(response => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(response.url()).pathname) && !new URL(response.url()).search);
    await hoverRow.hover(); const firstRequest = await fullStarted;
    await hoverRow.evaluate(element => element.click());
    await page.waitForFunction(id => new URL(location.href).searchParams.get("thread") === id && document.querySelector('[class~="group/bubble"]') && document.querySelector('[aria-label="Send reply"]')?.disabled, new URL(firstRequest.url()).pathname.split("/")[4]);
    const sendBlockedBeforeDetails = await page.getByRole("button", { name: "Send reply", exact: true }).isDisabled();
    await (await completed).finished();
    await page.waitForTimeout(250);
    if (fullRequests !== 1) throw new Error("Hover/click duplicated full detail.");
    results.push({ version, scenario: "hover_click_reuse", fullRequests, sendBlockedBeforeDetails });
    const link = page.locator('a[href="/inbox?view=waiting_customer"]').first();
    await link.click();
    await page.waitForURL(url => url.searchParams.get("view") === "waiting_customer");
    await page.waitForTimeout(800);
    const queueRscReads = rscReads;
    await page.goBack();
    await page.waitForURL(url => !url.searchParams.has("view"));
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get("view") === "waiting_customer");
    results.push({ version, scenario: "queue_navigation", queueRscReads, historyWorks: true, blockedWrites });
    await context.close();
  }
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await browser.close();
})().catch(async error => {
  console.error(String(error.message).replaceAll(process.env.DEV_LOGIN_EMAIL || "__none__", "[redacted]").replaceAll(process.env.DEV_LOGIN_PASSWORD || "__none__", "[redacted]"));
  if (browser) await browser.close();
  process.exitCode = 1;
});
