import {it,expect,describe,vi} from 'vitest';
import {ScriptedModel,modelResponse,assistantMessage} from '@openai/agents/testing';
import {runGreenfieldAgentWithAgentsSdk} from '../agents-sdk';
import {createDemoDependencies} from '../demo-fixtures';
import {InMemoryCommerceProvider} from '../providers';
import {PlaygroundDryRunExecutor} from '../action-executor';
import {normalizeStoredConversationContext} from '../../server/greenfield-thread-context';
const email='alice@example.test';
const order=(n,date='2026-01-01')=>({id:`order-${n}`,orderNumber:String(n),status:'paid',fulfillmentStatus:'unfulfilled',createdAt:date,items:[{id:'line',title:'Item',quantity:1}],fulfillments:[]});
async function session(orders=[order(101)],identity=email,providerEmail=email,assessment){
 const deps=await createDemoDependencies(),tenant={...deps.tenant,caseId:'case',customerEmail:identity};
 const commerce=new InMemoryCommerceProvider({customer:{email:providerEmail},orders});
 const get=vi.spyOn(commerce,'getOrder'),historyRead=vi.spyOn(commerce,'getOrderHistory');let context,history=[];
 return {get,historyRead,commerce,setIdentity(value){tenant.customerEmail=value;},async turn(message,ir,customModel){
 const model=customModel??new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]);
 const result=await runGreenfieldAgentWithAgentsSdk({tenant,message,history,conversationContext:context,capabilities:{...deps,tenant,commerce,conversationContext:context,remedyAuthorization:assessment},turnInterpreter:async()=>ir,model,interactionChannel:'playground',enableDevDiagnostics:true,actionExecutor:new PlaygroundDryRunExecutor()});
 context=normalizeStoredConversationContext(result.conversationContext);history.push({role:'user',content:message},{role:'assistant',content:result.response});
 expect(result.trace.events.some(e=>e.type==='error'&&e.data?.code==='agent_error')).toBe(false);
 expect(result.actionExecutions.every(a=>a.executed===false)).toBe(true);return result;
 }};
}
const status={actions:[],orderContext:'status'};
describe('Normal SDK CaseState runtime',()=>{
 it('uses identity and unique live candidate without asking for order number',async()=>{const s=await session();const r=await s.turn('Where is it?',status);expect(s.historyRead).toHaveBeenCalledWith(email);expect(r.conversationContext.activeOrder.requestedOrderId).toBe('101');expect(r.trace.diagnostics.fallback_reason).toBeNull();expect(r.response).not.toMatch(/email|order number/i);});
 it('keeps the order across arrival, order reference and ETA turns',async()=>{const s=await session([order(101),order(202)]);const a=await s.turn('My order has not arrived',status);expect(a.response).toContain('101');const b=await s.turn('#101',status);const c=await s.turn('When should it arrive?',status);expect(b.conversationContext.activeOrder.requestedOrderId).toBe('101');expect(c.conversationContext.activeOrder.requestedOrderId).toBe('101');expect(c.trace.diagnostics.fallback_reason).toBeNull();expect(s.get.mock.calls.length).toBeGreaterThanOrEqual(2);});
 it('retrieves the unique latest order using session identity',async()=>{const s=await session([order(101,'2026-01-01'),order(202,'2026-02-01')]);const r=await s.turn('Where is my latest order?',{...status,orderSelection:'latest'});expect(r.conversationContext.activeOrder.requestedOrderId).toBe('202');expect(r.response).not.toMatch(/email|order number/i);});
 it('asks one choice when latest candidates have equal dates',async()=>{const s=await session([order(101),order(202)]);const r=await s.turn('Where is my latest order?',{...status,orderSelection:'latest'});expect(r.conversationContext.activeOrder).toBeNull();expect(r.response).toMatch(/101/);expect(r.response).toMatch(/202/);expect(s.get).not.toHaveBeenCalled();});
 it('asks only missing identity and does not read an unauthorized order',async()=>{const s=await session([order(101)],null,null);const r=await s.turn('Where is #101?',status);expect(r.response).toMatch(/email/i);expect(s.get).not.toHaveBeenCalled();expect(s.historyRead).not.toHaveBeenCalled();expect(r.trace.diagnostics.fallback_reason).toBeNull();});
 it('bounds a provider identity mismatch with no order read',async()=>{const s=await session([order(101)],email,'bob@example.test');const r=await s.turn('Where is #101?',status);expect(r.conversationContext.caseState.identityUnavailable).toBe(true);expect(s.get).not.toHaveBeenCalled();expect(r.trace.diagnostics.fallback_reason).toBeNull();});
 it('rejects a provider returning the wrong order',async()=>{const s=await session();s.get.mockResolvedValue(order(202));const r=await s.turn('Where is #101?',status);expect(r.conversationContext.activeOrder.order).toBeNull();expect(r.response).not.toContain('202');expect(r.trace.diagnostics.fallback_reason).toBeNull();});
 it('retains action, order and confirmation until the address arrives',async()=>{const s=await session([order(101),order(202)]);const first='I need to change my delivery address';const a=await s.turn(first,{actions:[{action:'update_address',sourceText:first,orderReference:null,addressProvided:false}]});expect(a.proposedActions).toEqual([]);const b=await s.turn('#101',{actions:[]});expect(b.response).toMatch(/address/i);const c=await s.turn('Yes, that is my order',{actions:[],confirmation:{sourceText:'Yes, that is my order',confirmed:true}});expect(c.response).toMatch(/address/i);const address='12 Test Street, 8000 Aarhus, Denmark';const d=await s.turn(address,{actions:[],address:{value:address,complete:true}});expect(d.proposedActions).toHaveLength(1);expect(d.response).not.toMatch(/until you confirm|can you confirm/i);expect(d.trace.diagnostics.fallback_reason).toBeNull();});
 it('preserves active order for an item follow-up',async()=>{const s=await session();await s.turn('Where is #101?',status);const r=await s.turn('What about the other item?',status);expect(r.conversationContext.activeOrder.order.items[0].title).toBe('Item');expect(r.trace.diagnostics.fallback_reason).toBeNull();});
});

describe('Identity intake controls',()=>{
 it('uses supplied identity and order reference without another ask',async()=>{const s=await session();const r=await s.turn('alice@example.test, order #101',status);expect(r.conversationContext.activeOrder.state).toBe('verified');expect(r.response).not.toMatch(/what email|order number/i);});
 it('reuses verified identity from the prior case turn',async()=>{const s=await session();await s.turn('Where is #101?',status);s.setIdentity(null);const r=await s.turn('When will it arrive?',status);expect(r.conversationContext.caseState.scope.customerEmail).toBe(email);expect(r.conversationContext.activeOrder.state).toBe('verified');expect(r.trace.diagnostics.fallback_reason).toBeNull();});
});
describe('Live-data owner controls',()=>{
 it('keeps supplied order focus while retrieving items and fulfillment again',async()=>{const s=await session();await s.turn('Where is #101?',status);s.get.mockClear();const r=await s.turn('What about the other item?',status);expect(s.get).toHaveBeenCalledWith('101');expect(r.conversationContext.activeOrder.order.items).toHaveLength(1);});
});

describe('Customer evidence ownership in normal runtime',()=>{
 it('asks for a required photo without creating remedy permission',async()=>{
 const deps=await createDemoDependencies();
 const assessment={workspaceId:deps.tenant.workspaceId,shopId:deps.tenant.shopId,orderId:'101',action:'send_replacement',itemIds:['line'],decisionId:'assessment',evidenceReferences:[],requirements:[{name:'photo',owner:'customer',satisfied:false}],approved:false};
 const o={...order(101),fulfillmentStatus:'fulfilled'};const s=await session([o],email,email,assessment);
 const message='Replace my damaged item on #101';const r=await s.turn(message,{actions:[{action:'send_replacement',sourceText:message,orderReference:'101',addressProvided:false}]});
 expect(r.response).toMatch(/photo/i);expect(r.response).not.toMatch(/email|order number/i);expect(r.proposedActions).toEqual([]);expect(r.actionExecutions).toEqual([]);expect(r.trace.diagnostics.fallback_reason).toBeNull();
 });
});

it('keeps a failed candidate lookup provider-owned rather than requesting known identity',async()=>{const s=await session();s.historyRead.mockRejectedValue(new Error('Provider timeout'));const r=await s.turn('Where is my order?',status);expect(r.response).not.toMatch(/what email|order number|order reference\?/i);expect(r.trace.diagnostics.fallback_reason).toBeNull();expect(r.proposedActions).toEqual([]);});
