import {describe,it,expect,vi} from 'vitest';
import {ScriptedModel,assistantMessage,modelResponse} from '@openai/agents/testing';
import {runGreenfieldAgentWithAgentsSdk} from '../agents-sdk';
import {createDemoDependencies} from '../demo-fixtures';
import {InMemoryCommerceProvider} from '../providers';
import {prepareCaseContext,advanceCaseContext} from '../case-state';
import {createCapabilityRegistry} from '../capabilities';
import {validateStructuredResponse} from '../response-contract';
import {resolveOperationalAction} from '../operational-execution';
import {sanitizeGreenfieldTrace} from '../../server/greenfield-playground';
import {normalizeLiveShipment} from '../live-tracking';

async function setup({action=null,state=null,trackingState='in_transit',event=true,eta=null,channel='playground',permission='auto',address=true,second=false,trackingFailure=false}={}){
 const deps=await createDemoDependencies(),tenant={...deps.tenant,caseId:'case',customerEmail:'customer@example.test'};
 const fulfillment=(n)=>({id:`shipment-${n}`,status:'success',trackingNumber:`TRACK${n}`,carrier:'Carrier',items:[{orderLineItemId:'line',quantity:1}],itemMappingStatus:'verified'});
 const order={id:'order-101',orderNumber:'101',customerEmail:tenant.customerEmail,status:'paid',fulfillmentStatus:state,currency:'DKK',items:[{id:'line',productId:'product',variantId:'variant-old',variantTitle:'Black',title:'Lamp',quantity:1,unitPrice:'10.00',totalDiscount:'0'}],fulfillments:state? [fulfillment(1),...(second?[fulfillment(2)]:[])]:[]};
 const commerce=new InMemoryCommerceProvider({customer:{email:tenant.customerEmail},orders:[order]});
 const tracking={providerName:'fake_carrier',lookup:vi.fn(async input=>trackingFailure?{status:'unavailable',trackingNumber:input.trackingNumber,provider:'fake_carrier',observedAt:'2026-01-01'}:{status:'ok',data:{trackingNumber:input.trackingNumber,carrier:'Carrier',status:second&&input.trackingNumber==='TRACK2'?'delivered':trackingState,subStatus:null,latestEvent:event?{description:input.trackingNumber==='TRACK2'?'Delivered to destination':'Departed sorting center',timestamp:'2026-01-01',location:'City',status:trackingState,subStatus:null}:null,estimatedDelivery:eta,checkpoints:[],exception:null,observedAt:'2026-01-01',provider:'fake_carrier',source:'carrier'}})};
 const mutate=vi.fn(async command=>{if(command.action==='cancel_order')order.status='cancelled';if(command.action==='update_address')order.shippingAddress={...command.address};return{accepted:true};});
 const operational={permissions:{workspaceId:tenant.workspaceId,shopId:tenant.shopId,actions:Object.fromEntries(['cancel_order','update_address','update_order_line'].map(a=>[a,{mode:permission}]))},mutationProvider:{scope:{workspaceId:tenant.workspaceId,shopId:tenant.shopId},mutationsEnabled:true,supports:()=>true,mutate},catalog:{getOrderLineVariants:async()=>[{id:'variant-new',productId:'product',title:'Blue',options:['Blue'],price:'10.00',currency:'DKK',availableQuantity:3,availability:'available'}]}};
 const message=action==='cancel_order'?'Cancel #101':action==='update_address'?'Change the address on #101 to 12 Street, City 1000, Denmark':action==='update_order_line'?'Change Lamp Black to Blue on #101':'Where is #101?';
 const ir={actions:action?[{action,sourceText:message,orderReference:'101',addressProvided:address}]:[],orderContext:action?'change':'status',...(action==='update_address'&&address?{address:{value:'12 Street, City 1000, Denmark',complete:true,details:{address1:'12 Street',city:'City',zip:'1000',countryCode:'DK'}}}:{}),...(action==='update_order_line'?{lineChange:{sourceItem:'Lamp Black',targetVariant:'Blue',quantity:null}}:{})};
 const model=action?new ScriptedModel([]):new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[]}))])]);
 const options={tenant,message,model,operational,turnInterpreter:async()=>ir,capabilities:{...deps,tenant,commerce,tracking},interactionChannel:channel,enableDevDiagnostics:true};
 return {tenant,options,model,ir,order,commerce,tracking,operational,mutate,async run(){const r=await runGreenfieldAgentWithAgentsSdk(options);expect(r.trace.diagnostics.fallback_reason).toBeNull();return r;}};
}
describe('Deterministic operational runtime',()=>{
 for(const action of ['cancel_order','update_address','update_order_line'])it(`simulates ${action} with no model action tool or redundant confirmation`,async()=>{const s=await setup({action});const spy=vi.spyOn(s.model,'getResponse');const r=await s.run();expect(r.actionExecutions[0].operational.status).toBe('SIMULATED');expect(r.actionExecutions[0].executed).toBe(false);expect(s.mutate).not.toHaveBeenCalled();expect(spy).not.toHaveBeenCalled();expect(r.response).toContain('Simulated result');expect(r.response).not.toMatch(/until you confirm|are you sure/i);});
 for(const action of ['cancel_order','update_address'])it(`auto ${action} verifies read-back before rendering success`,async()=>{const s=await setup({action,channel:'support_inbox'});const r=await s.run();expect(r.actionExecutions[0].operational.status).toBe('EXECUTED');expect(r.actionExecutions[0].executed).toBe(true);expect(r.actionExecutions[0].operational.before.status).toBe('paid');expect(s.mutate).toHaveBeenCalledOnce();expect(r.response).not.toContain('Simulated');});
 it('never presents accepted-but-unverified mutation as success',async()=>{const s=await setup({action:'cancel_order',channel:'support_inbox'});s.mutate.mockResolvedValue({accepted:true});const r=await s.run();expect(r.response).not.toContain('has been cancelled');expect(r.actionExecutions[0].executed).toBe(false);});
 it('keeps ordinary HITL requests free of redundant confirmation',async()=>{const s=await setup({action:'cancel_order',permission:'hitl'});const r=await s.run();expect(r.actionExecutions[0].operational.status).toBe('PROPOSED');expect(r.response).not.toMatch(/please confirm|until you confirm|are you sure|has been cancelled/);expect(s.mutate).not.toHaveBeenCalled();});
 it('asks only for a missing address',async()=>{const s=await setup({action:'update_address',address:false});const r=await s.run();expect(r.response).toMatch(/complete new delivery address/);expect(r.response).not.toMatch(/email|order number/);});
 it('keeps TurnIR failure fail-closed even when an action model is provided',async()=>{const s=await setup({action:'cancel_order'});s.options.turnInterpreter=async()=>{throw Error('Provider failure')};s.options.model=new ScriptedModel([modelResponse([assistantMessage(JSON.stringify({segments:[{type:'fact',fact_kind:'order_fulfillment_status',evidence:[{result_id:'tool_result_1',field_paths:['fulfillmentStatus']}]}]}))])]);const r=await runGreenfieldAgentWithAgentsSdk(s.options);expect(s.mutate).not.toHaveBeenCalled();expect(r.actionExecutions).toEqual([]);expect(r.trace.diagnostics.turn_ir_unavailable).toBe(true);});
});
describe('Live tracking controls',()=>{
 for(const [name,opt,required,forbidden] of [
  ['in transit',{state:'fulfilled'},'on the way',null],
  ['delivered',{state:'fulfilled',trackingState:'delivered'},'delivered',null],
  ['ETA available',{state:'fulfilled',eta:'2026-01-05'},'2026',null],
  ['ETA unavailable',{state:'fulfilled',eta:null},'sorting center','expected delivery'],
  ['no current event',{state:'fulfilled',trackingState:null,event:false},'shipped','sorting center'],
  ['provider failure',{state:'fulfilled',trackingFailure:true},'shipped','sorting center'],
  ['unfulfilled',{state:null},'not','sorting center'],
  ['multiple fulfillments',{state:'partial',second:true},'Delivered to destination',null],
 ])it(name,async()=>{const s=await setup(opt);const r=await s.run();expect(r.response.toLowerCase()).toContain(required.toLowerCase());if(forbidden)expect(r.response.toLowerCase()).not.toContain(forbidden.toLowerCase());expect(s.tracking.lookup).toHaveBeenCalledTimes(opt.state?opt.second?2:1:0);if(opt.second){expect(r.response).toContain('TRACK1');expect(r.response).toContain('TRACK2');expect(r.response).toContain('Departed sorting center');}expect(s.mutate).not.toHaveBeenCalled();});
 for(const trackingNumber of ['', '<invalid>',null])it(`does not call carrier for missing/invalid number ${trackingNumber}`,async()=>{const s=await setup({state:'fulfilled'});s.order.fulfillments[0].trackingNumber=trackingNumber;await s.run();expect(s.tracking.lookup).not.toHaveBeenCalled();});
 it('preserves unknown status rather than inventing a live carrier state',()=>expect(normalizeLiveShipment({status:'unrecognized',latestEvent:null}).status).toBe('unknown'));
});
describe('Response contract and trace',()=>{
 it('rejects a model-created operational claim with no server decision',async()=>{const s=await setup({action:'cancel_order'});const registry=createCapabilityRegistry(s.options.capabilities);const validation=validateStructuredResponse({segments:[{type:'operational_result',basis:{result_id:'invented',field_paths:['data.operation']}}]},{...registry,interactionChannel:'playground',operationalScope:s.tenant});expect(validation.approvedSegments).toEqual([]);expect(validation.rejectedSegments[0].issues[0].code).toBe('operational_result_not_verified');});
 it('preserves SIMULATED before/after evidence in sanitized Playground trace',async()=>{const s=await setup({action:'cancel_order'});const r=await s.run();const trace=sanitizeGreenfieldTrace(r.trace);expect(trace.simulated_actions[0]).toMatchObject({status:'SIMULATED',executed:false,provider_mutation_attempted:false,read_back_verified:true,before_state:{status:'paid'},after_state:{status:'cancelled'}});});
});

describe('Operational CaseState continuity',()=>{
 it('carries line selection through a variant-only follow-up',async()=>{const s=await setup({action:'update_order_line'});const first={...s.ir,lineChange:{sourceItem:'Lamp Black',targetVariant:null,quantity:null}};let context=advanceCaseContext({...prepareCaseContext(undefined,s.tenant),activeOrder:{requestedOrderId:'101',state:'verified',order:s.order}},first,'Change Lamp Black');const follow={actions:[],lineChange:{sourceItem:null,targetVariant:'Blue',quantity:null}};context=advanceCaseContext(context,follow,'Blue');const {caseActionIntents}=await import('../case-state');const effective=caseActionIntents(context,follow);const outcome=await resolveOperationalAction({tenant:s.tenant,commerce:s.commerce,runtime:s.operational,channel:'playground'},context,effective);expect(outcome.status).toBe('SIMULATED');expect(outcome.command.variantId).toBe('variant-new');expect(s.mutate).not.toHaveBeenCalled();});
 for(const status of ['pre_transit','in_transit','out_for_delivery','delivered','exception','unknown'])it('preserves normalized shipment state '+status,()=>expect(normalizeLiveShipment({status,latestEvent:null}).status).toBe(status));
 it('rejects carrier evidence for a different tracking identifier',async()=>{const s=await setup({state:'fulfilled'});s.tracking.lookup.mockResolvedValue({status:'ok',data:{trackingNumber:'FOREIGN',status:'delivered',latestEvent:{description:'Foreign delivery'},estimatedDelivery:null}});const r=await s.run();expect(r.response).not.toContain('Foreign delivery');expect(s.mutate).not.toHaveBeenCalled();});
});

describe('Operational contract rejection controls',()=>{
 for(const patch of ['foreign_scope','unverified_read_back','wrong_after_state','executed_in_playground'])it('blocks '+patch,async()=>{const s=await setup({action:'cancel_order'});const r=await s.run();const outcome=structuredClone(r.actionExecutions[0].operational);if(patch==='foreign_scope')outcome.shopId='foreign';if(patch==='unverified_read_back')outcome.readBackVerified=false;if(patch==='wrong_after_state')outcome.after.status='paid';if(patch==='executed_in_playground'){outcome.mode='auto';outcome.status='EXECUTED';outcome.executed=true;outcome.providerMutationAttempted=true;}const registry=createCapabilityRegistry(s.options.capabilities);const record=registry.recordOperationalOutcome({operation:outcome});const validation=validateStructuredResponse({segments:[{type:'operational_result',basis:{result_id:record.resultId,field_paths:['data.operation']}}]},{...registry,interactionChannel:'playground',operationalScope:s.tenant});expect(validation.approvedSegments).toEqual([]);expect(validation.rejectedSegments[0].issues[0].code).toBe('operational_result_not_verified');});
});

describe('Completed operational intent lifecycle',()=>{
 it('does not reuse a completed address for a new request missing its address',async()=>{const s=await setup({action:'update_address'});const first=await s.run();expect(first.conversationContext.caseState.pendingAction).toBeUndefined();expect(first.conversationContext.caseState.address).toBeUndefined();s.options.conversationContext=first.conversationContext;s.options.message='Change the delivery address on #101';s.options.turnInterpreter=async()=>({actions:[{action:'update_address',sourceText:s.options.message,orderReference:'101',addressProvided:false}],orderContext:'change'});const second=await s.run();expect(second.response).toContain('complete new delivery address');expect(second.actionExecutions[0].operational.status).toBe('BLOCKED');expect(s.mutate).not.toHaveBeenCalled();});
});
