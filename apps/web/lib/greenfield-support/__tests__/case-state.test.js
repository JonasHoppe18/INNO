import { describe,it,expect } from 'vitest';
import { prepareCaseContext,advanceCaseContext,resolvedCaseEmail,caseActionIntents,confirmedCaseAction,caseIntakeRequirements } from '../case-state';
import { normalizeStoredConversationContext } from '../../server/greenfield-thread-context';
const t={workspaceId:'workspace',shopId:'shop',caseId:'case',customerEmail:'alice@example.test'};
const ir={actions:[]}, intent={actions:[{action:'update_address',sourceText:'Change address',orderReference:'101',addressProvided:false}]};
const order=(id='101')=>({requestedOrderId:id,state:'verified',order:{id:`order-${id}`,orderNumber:id,status:'paid',items:[],fulfillments:[]}});
const ctx=()=>({...prepareCaseContext(undefined,t),activeOrder:order()});
const pending=()=>advanceCaseContext(ctx(),intent,'Change address');
describe('CaseState continuity',()=>{
 it('retains reference while requiring a new live read',()=>expect(prepareCaseContext(ctx(),t).activeOrder).toMatchObject({requestedOrderId:'101',state:'unresolved',order:null}));
 it('carries intent through an order follow-up',()=>expect(caseActionIntents(pending(),ir,true).actions[0].action).toBe('update_address'));
 it('does not carry action into status questions',()=>expect(caseActionIntents(pending(),{actions:[],orderContext:'status'}).actions).toEqual([]));
 it('fails closed when interpretation fails',()=>expect(caseActionIntents(pending(),null,true)).toBeNull());
 it('keeps confirmation through the complete address follow-up',()=>{let c=pending();c=advanceCaseContext(c,{actions:[],confirmation:{sourceText:'Yes',confirmed:true}},'Yes');c=advanceCaseContext(c,{actions:[],address:{value:'12 Street, 1000 City, Denmark',complete:true}},'12 Street, 1000 City, Denmark');expect(confirmedCaseAction(c,'update_address')).toBe(true);expect(caseActionIntents(c,{actions:[],address:{value:c.caseState.address.value,complete:true}}).actions[0].addressProvided).toBe(true);});
 it('drops prior address and action when order changes',()=>{let c=advanceCaseContext(pending(),{actions:[],address:{value:'Address',complete:true}},'Address');c=advanceCaseContext(c,ir,'#202',order('202'));expect(c.caseState.address).toBeUndefined();expect(c.caseState.pendingAction).toBeUndefined();});
 it('round-trips state through persistence without cached live truth',()=>{const c=pending(),p=normalizeStoredConversationContext(c);expect(p.caseState).toEqual(c.caseState);expect(p.activeOrder.order).toBeNull();});
});
describe('Verified identity isolation',()=>{
 it('uses session identity',()=>expect(resolvedCaseEmail(undefined,t)).toBe(t.customerEmail));
 it('reuses same-case verified identity',()=>expect(resolvedCaseEmail(ctx(),{...t,customerEmail:null})).toBe(t.customerEmail));
 it('does not promote a quoted email into authorization',()=>{const c=advanceCaseContext(prepareCaseContext(undefined,{...t,customerEmail:null}),ir,t.customerEmail);expect(resolvedCaseEmail(c,{...t,customerEmail:null})).toBeNull();expect(caseIntakeRequirements(c,{actions:[],orderContext:'status'})[0]).toEqual({field:'identity_verification',owner:'human'});});
 for(const change of [{caseId:'other'},{workspaceId:'other'},{shopId:'other'},{customerEmail:'bob@example.test'}])it(`drops unrelated scope ${JSON.stringify(change)}`,()=>{const c=prepareCaseContext(pending(),{...t,...change});expect(c.activeOrder).toBeNull();expect(c.caseState.pendingAction).toBeUndefined();});
 it('does not reuse an unavailable identity',()=>{const c=ctx();c.caseState.identityUnavailable=true;expect(resolvedCaseEmail(c,{...t,customerEmail:null})).toBeNull();});
 it('preserves unavailable identity fingerprint against another customer',()=>{const c=ctx();c.caseState.identityUnavailable=true;const p=prepareCaseContext(c,{...t,customerEmail:null});expect(p.caseState.scope.customerEmail).toBe(t.customerEmail);expect(prepareCaseContext(p,{...t,customerEmail:'bob@example.test'}).activeOrder).toBeNull();});
 it('requires case binding for identity adoption',()=>expect(resolvedCaseEmail(ctx(),{...t,caseId:undefined,customerEmail:null})).toBeNull());
});
describe('Requirement ownership',()=>{
 it('asks only missing identity',()=>expect(caseIntakeRequirements(prepareCaseContext(undefined,{...t,customerEmail:null}),{actions:[],orderContext:'status'})).toEqual([{field:'customer_email',owner:'customer'}]));
 it('does not authorize by order reference',()=>{const c=prepareCaseContext(undefined,{...t,customerEmail:null});c.activeOrder=order();expect(caseIntakeRequirements(c,ir)[0].field).toBe('customer_email');});
 it('asks for ambiguous choice without reasking identity',()=>expect(caseIntakeRequirements(prepareCaseContext(undefined,t),{actions:[],orderContext:'status'},[{orderNumber:'101'},{orderNumber:'202'}])).toEqual([{field:'order_choice',owner:'customer'}]));
 it('asks for unresolved antecedent',()=>expect(caseIntakeRequirements(prepareCaseContext(undefined,t),{actions:[],orderContext:'status'})[0].field).toBe('order_reference'));
 it('uses resolved live data',()=>expect(caseIntakeRequirements(ctx(),{actions:[],orderContext:'status'})).toEqual([]));
 it('keeps provider failure live-owned',()=>expect(caseIntakeRequirements(prepareCaseContext(ctx(),t),ir,[],'error')).toEqual([{field:'order_lookup',owner:'live_data'}]));
 it('asks only the missing edit',()=>expect(caseIntakeRequirements(advanceCaseContext(ctx(),{actions:[],orderContext:'change'},'Change order'),ir)).toEqual([{field:'desired_change',owner:'customer'}]));
 it('bounds unsupported permission',()=>expect(caseIntakeRequirements(advanceCaseContext(ctx(),{actions:[],changeKind:'variant',changeDescription:'Change variant'},'Change variant'),ir)).toEqual([{field:'variant_edit',owner:'human'}]));
});

describe('Known customer values remain scoped',()=>{
 it('keeps a selected product within the same case',()=>{const c=ctx();c.customerProvided={product:'Selected item'};expect(prepareCaseContext(c,t).customerProvided).toEqual(c.customerProvided);expect(prepareCaseContext(c,{...t,caseId:'other'}).customerProvided).toBeUndefined();});
 it('clears confirmation after an address materially changes',()=>{let c=advanceCaseContext(pending(),{actions:[],address:{value:'First address',complete:true}},'First address');c=advanceCaseContext(c,{actions:[],confirmation:{sourceText:'Yes',confirmed:true}},'Yes');c=advanceCaseContext(c,{actions:[],address:{value:'Other address',complete:true}},'Other address');expect(confirmedCaseAction(c,'update_address')).toBe(false);});
 it('does not accept confirmation before live verification',()=>{const c=prepareCaseContext(pending(),t);const n=advanceCaseContext(c,{actions:[],confirmation:{sourceText:'Yes',confirmed:true}},'Yes');expect(n.caseState.actionConfirmation).toBeUndefined();});
 it('withdraws pending action on an explicit denial',()=>{const n=advanceCaseContext(pending(),{actions:[],confirmation:{sourceText:'No',confirmed:false}},'No');expect(n.caseState.pendingAction).toBeUndefined();expect(confirmedCaseAction(n,'update_address')).toBe(false);});
});
describe('Explicit assessment input ownership',()=>{
 const assessment={workspaceId:t.workspaceId,shopId:t.shopId,orderId:'101',action:'send_replacement',itemIds:['line'],decisionId:'assessment',evidenceReferences:[],requirements:[{name:'photo',owner:'customer',satisfied:false}],approved:false};
 const replacement={actions:[{action:'send_replacement',sourceText:'Replace it',orderReference:'101',addressProvided:false}]};
 const scoped=()=>{const c=ctx();c.activeOrder.order.items=[{id:'line',title:'Item',quantity:1}];return c;};
 it('asks only explicitly required customer-owned evidence',()=>expect(caseIntakeRequirements(scoped(),replacement,[],undefined,assessment)).toEqual([{field:'photo',owner:'customer'}]));
 it('does not reask satisfied evidence',()=>expect(caseIntakeRequirements(scoped(),replacement,[],undefined,{...assessment,requirements:[{name:'photo',owner:'customer',satisfied:true}]})).toEqual([]));
 for(const patch of [{workspaceId:'other'},{shopId:'other'},{orderId:'202'},{action:'create_refund'},{itemIds:['other']}])it(`ignores unrelated requirement ${JSON.stringify(patch)}`,()=>expect(caseIntakeRequirements(scoped(),replacement,[],undefined,{...assessment,...patch})).toEqual([]));
 it('does not convert human approval into customer input',()=>expect(caseIntakeRequirements(scoped(),replacement,[],undefined,{...assessment,requirements:[{name:'photo',owner:'human',satisfied:false}]})).toEqual([]));
});
