const {createRequire}=require('node:module');const req=createRequire(process.cwd()+'/package.json');req('@next/env').loadEnvConfig(process.cwd()+'/apps/web');
const {createClient}=req('@supabase/supabase-js');
(async()=>{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL; if(!url.includes('zxaoycxzdjrbnzvbullk'))throw Error('Dev required');
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const profile=await db.from('profiles').select('clerk_user_id').eq('email',process.env.DEV_LOGIN_EMAIL).limit(1).maybeSingle();
 if(profile.error||!profile.data?.clerk_user_id)throw Error('Dev profile not found');
 const userId=profile.data.clerk_user_id;
 const joined=await db.from('workspace_members').select('workspace_id,workspaces!inner(clerk_org_id)').eq('clerk_user_id',userId).limit(1).maybeSingle();
 if(joined.error||!joined.data?.workspaces?.clerk_org_id)throw Error('Joined scope unavailable');
 const orgId=joined.data.workspaces.clerk_org_id;
 const denied = await db.from('workspace_members').select('workspace_id,workspaces!inner(clerk_org_id)')
   .eq('clerk_user_id',userId).eq('workspaces.clerk_org_id',orgId+'-not-a-workspace').maybeSingle();
 if(denied.error || denied.data)throw Error('Unknown organization did not fail closed');
 const results=[];
 for(let round=0;round<6;round++)for(const version of round%2?['joined','separate']:['separate','joined']){
  const start=performance.now();let workspaceId;
  if(version==='separate'){
   const [p,w]=await Promise.all([db.from('profiles').select('user_id').eq('clerk_user_id',userId).maybeSingle(),db.from('workspaces').select('id').eq('clerk_org_id',orgId).maybeSingle()]);
   if(p.error||w.error)throw Error('Scope lookup failed');
   const m=await db.from('workspace_members').select('workspace_id').eq('workspace_id',w.data.id).eq('clerk_user_id',userId).maybeSingle();if(m.error)throw Error('Membership failed');workspaceId=m.data?.workspace_id;
  }else{
   const [p,m]=await Promise.all([db.from('profiles').select('user_id').eq('clerk_user_id',userId).maybeSingle(),db.from('workspace_members').select('workspace_id,workspaces!inner(clerk_org_id)').eq('clerk_user_id',userId).eq('workspaces.clerk_org_id',orgId).maybeSingle()]);
   if(p.error||m.error)throw Error('Joined authorization failed');workspaceId=m.data?.workspace_id;
  }
  results.push({round,version,ms:Math.round(performance.now()-start),sameWorkspace:workspaceId===joined.data.workspace_id});
 }
 console.log(JSON.stringify({unknownOrganizationDenied:true,results}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
