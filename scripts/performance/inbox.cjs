// Read-only browser probe. Outputs durations and assertions, never message bodies.
const fs = require("node:fs");
const { createRequire } = require("node:module");
createRequire(process.cwd() + "/package.json")("@next/env").loadEnvConfig(process.cwd() + "/apps/web");
const { chromium } = require(process.env.PERF_PLAYWRIGHT_PATH || "/tmp/sona-performance-browser/node_modules/playwright");
const output = process.env.PERF_OUTPUT_FILE || "/tmp/sona-inbox-measurements.json";
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PERF_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const results = [];
  for (const version of ["before", "after"]) {
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
    for (const scenario of ["cold_click", "hover_prefetch"]) {
      const samples = [];
      for (let round = 0; round < 3; round++) {
        await context.clearCookies({ name: "sona-selected-thread" });
        const page = await context.newPage();
        await page.goto(base + "/inbox");
        const rows = page.locator('button[draggable="true"]');
        await rows.nth(round + 1).waitFor({ timeout: 30000 });
        await page.waitForTimeout(1000);
        const row = rows.nth(round + 1);
        const responsePending = page.waitForResponse(response => /\/api\/inbox\/threads\/[^/]+\/detail$/.test(new URL(response.url()).pathname) && response.request().method() === "GET");
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
        samples.push({ dataMs, status: response.status(), belongsToSelection });
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
