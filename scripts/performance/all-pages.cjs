const fs=require('node:fs');
const {createRequire}=require('node:module');
const app=createRequire(process.cwd()+'/package.json');
app('@next/env').loadEnvConfig(process.cwd()+'/apps/web');
const {chromium}=require(process.env.PERF_PLAYWRIGHT_PATH || '/tmp/sona-performance-browser/node_modules/playwright');
const version=process.env.PERF_VERSION||'before';
const base=version==='before'?(process.env.PERF_BEFORE_URL||'http://localhost:3108'):(process.env.PERF_AFTER_URL||'http://localhost:3107');
const output=process.env.PERF_OUTPUT_FILE||`/tmp/sona-performance-${version}.json`;
const sanitizePath=path=>path.replace(/(\/knowledge\/product-questions\/)(?!general$)[^/?]+/,'$1:productId');
const routes=fs.readdirSync('apps/web/app/(dashboard)',{recursive:true}).filter(p=>/page\.(jsx|tsx|js)$/.test(p)&&!p.includes('[')).map(p=>'/'+p.replace(/\/page\.(jsx|tsx|js)$/,'')).sort();
routes.push('/knowledge/returns','/knowledge/shipping','/knowledge/general');
if(process.env.PERF_EXTRA_ROUTES){routes.splice(0,routes.length,...['/guides/connect-mail','/guides/connect-shopify','/guides/connect-webshipper','/guides/connect-gls','/guides/connect-zendesk',process.env.PERF_PRODUCT_ROUTE].filter(Boolean));}
if(process.env.PERF_ROUTES){const selected=process.env.PERF_ROUTES.split(',');routes.splice(0,routes.length,...selected);}
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.PERF_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1470,height:900}});
 const login=await context.newPage();await login.goto(base+'/inbox');
 await login.locator('input[name=identifier]').fill(process.env.DEV_LOGIN_EMAIL);
 await login.locator('input[name=password]').fill(process.env.DEV_LOGIN_PASSWORD);
 await login.locator('input[name=password]').press('Enter');
 await login.waitForURL(u=>u.pathname!='/sign-in',{timeout:30000});
 await login.locator('[aria-label="Customers"]:visible').first().waitFor({timeout:30000});await login.close();
 // Do not execute app mutations while profiling page reads.
 let blockedWrites=0;
 await context.route('**/*',async route=>{
  const req=route.request();
  if((req.url().startsWith(base+'/api/')||req.url().includes('zxaoycxzdjrbnzvbullk.supabase.co/rest/'))&&!['GET','HEAD','OPTIONS'].includes(req.method())){blockedWrites++;await route.fulfill({status:409,contentType:'application/json',body:'{"error":"Writes disabled during performance probe"}'});}
  else await route.continue();
 });
 const results=(process.env.PERF_ROUTES||process.env.PERF_EXTRA_ROUTES)&&fs.existsSync(output)?JSON.parse(fs.readFileSync(output)).filter(row=>!routes.map(sanitizePath).includes(row.path)):[];
 for(const path of routes){
  const page=await context.newPage();
  const origin=path==='/integrations'?'/dashboard':'/integrations';
  await page.goto(base+origin);await page.locator('h1').first().waitFor();await page.waitForFunction(()=>Boolean(window.next?.router));
  const pending=new Set();let start=0,lastRead=0,reads=0;const errors=[];
  const isRead=req=>req.method()==='GET'&&(req.url().startsWith(base+'/api/')||req.url().includes('zxaoycxzdjrbnzvbullk.supabase.co/rest/'));
  page.on('request',req=>{if(start&&isRead(req)){pending.add(req);reads++;}});
  page.on('requestfinished',req=>{if(pending.delete(req))lastRead=Date.now()-start;});
  page.on('requestfailed',req=>{if(pending.delete(req))lastRead=Date.now()-start;});
  page.on('response',res=>{if(start&&isRead(res.request())&&res.status()>=400)errors.push({status:res.status(),api:new URL(res.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,':id')});});
  await page.waitForTimeout(1000);
  const samples=[];
  for(let round=0;round<3;round++){
   if(round){await page.evaluate(origin=>window.next.router.push(origin),origin);await page.waitForURL(base+origin);await page.waitForTimeout(900);}
   pending.clear();errors.length=0;reads=0;lastRead=0;start=Date.now();
   await page.evaluate(path=>window.next.router.push(path),path);
   let quietStart=Date.now();const deadline=Date.now()+20000;
   while(Date.now()<deadline){
    await page.waitForTimeout(100);
    if(pending.size||Date.now()-start<600||Date.now()-start-lastRead<800){quietStart=Date.now();continue;}
    if(Date.now()-quietStart>=400)break;
   }
   const elapsed=Date.now()-start;
   const state=await page.evaluate(()=>({path:location.pathname,heading:document.querySelector('h1,h2,h3')?.textContent||'',skeletons:document.querySelectorAll('.dashboard-theme .animate-pulse').length,router:Boolean(window.next?.router)}));
   const sample={round,elapsedMs:elapsed,lastReadMs:lastRead,reads,pending:pending.size,finalPath:sanitizePath(state.path),hasHeading:!!state.heading,skeletons:state.skeletons,errors:[...errors]};
   samples.push(sample);start=0;
   if(!state.router){await page.goto(base+'/integrations');await page.waitForFunction(()=>Boolean(window.next?.router));}
  }
  const result={version,path:sanitizePath(path),samples,blockedWrites};results.push(result);
  console.log(JSON.stringify(result));fs.writeFileSync(output,JSON.stringify(results,null,2));
  await page.close();
 }
 await browser.close();
})().catch(async e=>{console.error(String(e.message).replaceAll(process.env.DEV_LOGIN_EMAIL||'__none__','[redacted]').replaceAll(process.env.DEV_LOGIN_PASSWORD||'__none__','[redacted]'));if(browser)await browser.close();process.exitCode=1});
