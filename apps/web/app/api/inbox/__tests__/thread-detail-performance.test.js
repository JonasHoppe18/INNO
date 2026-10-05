import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ calls: [], proposal: false, saved: null, authorized: true }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "viewer", orgId: "org" }) }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: async () => ({ workspaceId: "workspace-a", supabaseUserId: "profile-a" }),
  applyScope: (query, scope) => query.eq("workspace_id", scope.workspaceId),
}));
vi.mock("@/lib/server/email-signature", () => ({
  normalizePlainText: value => value || "",
  loadEmailSignatureConfig: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return { closingText: "Test" }; },
  composeEmailBodyWithSignature: ({bodyText, bodyHtml}) => ({ finalBodyText: bodyText, finalBodyHtml: bodyHtml }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from(table) {
    const filters=[];let fields="",single=false;
    const query={
      select(value){fields=value;return query;}, eq(...args){filters.push(args);return query;},
      in(...args){filters.push(args);return query;},not(){return query;},neq(){return query;},
      order(){return query;},limit(){return query;},maybeSingle(){single=true;return query;},
      then(done){
        fixture.calls.push({table,fields,filters,start:Date.now()});
        let data=null;
        if(table==="mail_threads")data=fixture.authorized?{id:"thread-a",mailbox_id:"mail-a",provider_thread_id:"provider-a"}:null;
        if(table==="profiles")data={signature:"Test"};
        if(table==="mail_accounts")data={id:"mail-a",workspace_id:"workspace-a",shop_id:"shop-a"};
        if(table==="drafts")data=fields.includes("execution_state")?(fixture.proposal?{kind:"action_proposal"}:null):{};
        if(table==="mail_messages"){
          if(filters.some(([key])=>key==="is_draft"))data=fixture.saved;
          else if(fields.includes("ai_draft_text")&&single)data={id:"inbound-a",ai_draft_text:"Generated reply"};
          else data=[{id:"message-a",thread_id:"thread-a",body_text:"Customer message"}];
        }
        if(table==="mail_attachments")data=[];
        return new Promise(resolve=>setTimeout(()=>resolve({data,error:null}),20)).then(done);
      },
    };return query;
  }}),
}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function run({proposal=false,saved=null,authorized=true}={}){
  vi.resetModules();fixture.calls=[];Object.assign(fixture,{proposal,saved,authorized});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test-key");
  vi.useFakeTimers();const {GET}=await import("../threads/[threadId]/detail/route.js");
  const start=Date.now();const pending=GET(null,{params:{threadId:"thread-a"}});await vi.runAllTimersAsync();
  const response=await pending;return {status:response.status,payload:await response.json(),duration:Date.now()-start};
}
describe("thread detail read scheduling",()=>{
  it("runs independent reads together and preserves scoped generated draft data",async()=>{
    const result=await run();
    expect(result.status).toBe(200);expect(result.payload.messages[0].thread_id).toBe("thread-a");
    expect(result.payload.draft.draft.rendered_body_text).toBe("Generated reply");
    expect(result.duration).toBe(60);
    expect(fixture.calls.find(c=>c.table==="mail_threads").filters).toContainEqual(["workspace_id","workspace-a"]);
    expect(fixture.calls.find(c=>c.table==="mail_messages").filters).toContainEqual(["mailbox_id","mail-a"]);
  });
  it("does not use an AI reply for a pending action proposal",async()=>{
    const result=await run({proposal:true});expect(result.payload.draft.proposal_only).toBe(true);
    expect(result.payload.draft.draft).toBeNull();
    expect(fixture.calls.some(c=>c.fields==="id, ai_draft_text, subject, created_at")).toBe(false);
  });
  it("retains saved draft precedence and denies unknown threads before body reads",async()=>{
    const result=await run({saved:{id:"saved-a",body_text:"Agent edit"}});
    expect(result.payload.draft.draft.id).toBe("saved-a");
    const denied=await run({authorized:false});expect(denied.status).toBe(404);
    expect(fixture.calls.map(c=>c.table)).toEqual(["mail_threads"]);
  });
});
