// Run from the repository root against two local production builds.
// Output contains timings and HTTP status only; no response bodies or identity.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const app = createRequire(process.cwd() + '/package.json');
app('@next/env').loadEnvConfig(process.cwd()+'/apps/web');
const {chromium}=require(process.env.PERF_PLAYWRIGHT_PATH || '/tmp/sona-performance-browser/node_modules/playwright');
const beforeUrl = process.env.PERF_BEFORE_URL || 'http://localhost:3108';
const afterUrl = process.env.PERF_AFTER_URL || 'http://localhost:3107';
const output = process.env.PERF_OUTPUT_FILE || '/tmp/sona-navigation-measurements.json';
let browser;
const targets=[
 {key:'dashboard_initial',path:'/dashboard',heading:'Support overview',initial:true},
 {key:'dashboard_navigation',path:'/dashboard',heading:'Support overview',label:'Dashboard'},
 {key:'customers_navigation',path:'/customers',heading:'Customers',label:'Customers',api:'/api/customers'},
 {key:'analytics_navigation',path:'/analytics',heading:'Analytics',label:'Analytics',api:'/api/analytics/overview'},
];
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.PERF_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1470,height:900}});
 // Login once; Clerk session cookies are shared by the two localhost ports.
 const login=await context.newPage();
 await login.goto(`${afterUrl}/inbox`);
 await login.locator('input[name=identifier]').fill(process.env.DEV_LOGIN_EMAIL);
 await login.locator('input[name=password]').fill(process.env.DEV_LOGIN_PASSWORD);
 await login.locator('input[name=password]').press('Enter');
 await login.waitForURL(u=>u.pathname!='/sign-in',{timeout:30000});
 await login.locator('[aria-label="Customers"]:visible').first().waitFor({timeout:30000});
 await login.close();
 const samples=[];
 for(let round=0;round<6;round++){
  for(const version of round%2?['after','before']:['before','after']){
   const origin=version==='before'?beforeUrl:afterUrl;
   for(const target of targets){
    const page=await context.newPage();
    await page.addInitScript(({target})=>{
     window.__measurement={start:target.initial?0:null,heading:null,feedback:null,data:null,status:null};
     const record=()=>{
      const m=window.__measurement;
      if(m.start===null)return;
      const heading=Array.from(document.querySelectorAll('h1')).find(el=>el.textContent.trim()===target.heading&&el.getBoundingClientRect().height>0);
      if(heading&&m.heading===null)m.heading=performance.now()-m.start;
      if(m.feedback===null&&(heading||document.querySelector('[aria-busy="true"]')))m.feedback=performance.now()-m.start;
     };
     new MutationObserver(record).observe(document,{childList:true,subtree:true,attributes:true});
     document.addEventListener('click',event=>{
      const link=event.target.closest('a');
      if(link&&new URL(link.href).pathname===target.path){
       window.__measurement={start:performance.now(),heading:null,feedback:null,data:null,status:null};
      }
     },true);
     const original=window.fetch;
     window.fetch=async(...args)=>{
      const response=await original(...args);
      const url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.origin);
      if(target.api&&url.pathname===target.api&&window.__measurement.start!==null){
       response.clone().arrayBuffer().then(()=>{
        const m=window.__measurement;
        if(m.data===null){m.data=performance.now()-m.start;m.status=response.status;}
       });
      }
      return response;
     };
    },{target});
    if(target.initial){
     await page.goto(`${origin}${target.path}`,{waitUntil:'commit'});
    }else{
     await page.goto(`${origin}/integrations`,{waitUntil:'domcontentloaded'});
     await page.locator(`[aria-label="${target.label}"]:visible`).first().waitFor();
     await page.waitForTimeout(1000); // Identical allowance for normal route prefetch.
     await page.locator(`[aria-label="${target.label}"]:visible`).first().click();
    }
    await page.waitForFunction(()=>window.__measurement.heading!==null,{},{timeout:30000});
    if(target.api)await page.waitForFunction(()=>window.__measurement.data!==null,{},{timeout:30000});
    const measurement=await page.evaluate(()=>window.__measurement);
    const navigation=target.initial?await page.evaluate(()=>performance.getEntriesByType('navigation')[0].responseStart):null;
    const sample={round,version,scenario:target.key,feedbackMs:Math.round(measurement.feedback),headingMs:Math.round(measurement.heading),dataMs:measurement.data===null?Math.round(measurement.heading):Math.round(measurement.data),status:measurement.status,ttfbMs:navigation===null?null:Math.round(navigation)};
    samples.push(sample);
    console.log(JSON.stringify(sample));
    fs.writeFileSync(output,JSON.stringify(samples,null,2));
    await page.close();
   }
  }
 }
 await browser.close();
})().catch(async e=>{console.error(String(e.message).replaceAll(process.env.DEV_LOGIN_EMAIL || '__missing_email__', '[redacted]').replaceAll(process.env.DEV_LOGIN_PASSWORD || '__missing_password__', '[redacted]'));if(browser)await browser.close();process.exitCode=1});
