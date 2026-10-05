import { describe, expect, it } from "vitest";
import { resolveClientInboxScope } from "../resolve-inbox-scope.js";
const uuid="11111111-1111-4111-8111-111111111111";
function fixture({org="org-a", member=true, memberships=[{workspace_id:"workspace-a"}]}={}) {
  const calls=[];
  const db={from(table){
    const filters=[];let single=false;
    const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},order(){return query;},limit(){return query;},maybeSingle(){single=true;return query;},then(done){
      calls.push({table,filters});
      const data=table==="profiles"?{user_id:uuid}:table==="workspaces"?(org?{id:"workspace-a"}:null):single?(org&&member?{workspace_id:"workspace-a"}:null):memberships;
      return Promise.resolve({data,error:null}).then(done);
    }};return query;
  }};return {db,calls};
}
describe("client inbox workspace selection",()=>{
  it("uses and verifies the active organization instead of selecting the latest membership",async()=>{
    const {db,calls}=fixture();
    const scope=await resolveClientInboxScope({supabase:db,clerkUserId:"viewer",orgId:"org-a"});
    expect(scope).toEqual({supabaseUserId:uuid,workspaceId:"workspace-a"});
    expect(calls).toHaveLength(2);
    expect(calls.find(c=>c.table==="workspace_members").filters).toContainEqual(["workspaces.clerk_org_id","org-a"]);
    expect(calls.find(c=>c.table==="workspace_members").filters).toContainEqual(["clerk_user_id","viewer"]);
  });
  it("denies an unavailable organization or revoked membership without falling back",async()=>{
    await expect(resolveClientInboxScope({supabase:fixture({org:null}).db,clerkUserId:"viewer",orgId:"org-a"})).rejects.toThrow("not available");
    await expect(resolveClientInboxScope({supabase:fixture({member:false}).db,clerkUserId:"viewer",orgId:"org-a"})).rejects.toThrow("not available");
  });
  it("rejects ambiguous personal membership and prefers the canonical profile UUID",async()=>{
    await expect(resolveClientInboxScope({supabase:fixture({memberships:[{workspace_id:"a"},{workspace_id:"b"}]}).db,clerkUserId:"viewer"})).rejects.toThrow("explicitly");
    const result=await resolveClientInboxScope({supabase:fixture().db,clerkUserId:"viewer",fallbackUserId:"wrong-profile"});
    expect(result.supabaseUserId).toBe(uuid);
  });
});
