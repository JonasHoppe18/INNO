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
    const page = await context.newPage();
    const bootstrapPending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/bootstrap");
    await page.goto(base + "/settings");
    const bootstrapResponse = await bootstrapPending;
    const bootstrap = await bootstrapResponse.json();
    const statuses = Object.fromEntries(Object.entries(bootstrap.resources || {}).map(([path, result]) => [path, result.status]));
    console.log(JSON.stringify({ statuses }));
    if (Object.keys(statuses).length !== 9 || Object.values(statuses).some(status => status !== 200)) throw new Error("A Settings resource failed.");
    if (!bootstrap.resources["/api/settings/members"].payload.workspace_id) throw new Error("Settings workspace missing.");
    const nameInput = page.locator('input[placeholder="Team name"]');
    await nameInput.waitFor();
    await page.waitForTimeout(300);
    let rscReads = 0;
    page.on("request", request => { if (request.headers().rsc === "1") rscReads++; });
    const nav = page.getByRole("navigation", { name: "Settings navigation" });
    const originalName = await nameInput.inputValue();
    await nameInput.fill(originalName + " temporary probe");
    let discardAsked = false;
    page.once("dialog", async dialog => { discardAsked = true; await dialog.dismiss(); });
    await nav.getByRole("button", { name: "Members", exact: true }).click();
    await page.waitForTimeout(200);
    const unsavedPreserved = discardAsked && !new URL(page.url()).searchParams.has("tab") && (await nameInput.inputValue()) === originalName + " temporary probe";
    if (!unsavedPreserved) throw new Error("Unsaved settings guard failed.");
    await nameInput.fill(originalName);
    for (const [label, tab] of [["Members", "members"], ["Email", "email"], ["General", "general"]]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await page.waitForURL(url => url.searchParams.get("tab") === tab);
    }
    await page.goBack();
    await page.waitForURL(url => url.searchParams.get("tab") === "email");
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get("tab") === "general");
    await page.waitForTimeout(500);
    results.push({ version, statuses, unsavedPreserved, historyWorks: true, tabRscReads: rscReads, blockedWrites });
    if (rscReads) throw new Error("Settings tabs still request server renders.");
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
