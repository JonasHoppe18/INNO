import {it,expect,vi} from 'vitest';
import {createDemoDependencies} from '../demo-fixtures';
import {createCapabilityRegistry} from '../capabilities';
import {InMemoryCommerceProvider,InMemoryTrackingProvider} from '../providers';
it('retrieves tracking from fresh order evidence rather than requiring customer re-intake',async()=>{
 const deps=await createDemoDependencies(),tenant={...deps.tenant,customerEmail:'alice@example.test'};
 const order={id:'order-101',orderNumber:'101',status:'paid',fulfillmentStatus:'fulfilled',items:[{id:'line',title:'Item',quantity:1}],fulfillments:[{id:'shipment',status:'success',carrier:'Carrier',trackingNumber:'TRACK101',trackingUrl:'https://example.test/track',shipmentStatus:'in_transit',items:[],itemMappingStatus:'unavailable'}]};
 const commerce=new InMemoryCommerceProvider({customer:{email:tenant.customerEmail},orders:[order]});
 const tracking=new InMemoryTrackingProvider([{orderId:order.id,trackingNumber:'TRACK101',carrier:'Carrier',status:'in_transit'}]);
 const lookup=vi.spyOn(tracking,'lookup');
 const registry=createCapabilityRegistry({...deps,tenant,commerce,tracking,customerMessage:'Where is my shipment?',turnIR:{actions:[],orderContext:'status'},conversationContext:{turn:1,activeOrder:{state:'verified',requestedOrderId:'101',order:null},customerSignal:null}});
 await registry.resolveCustomerOrderContext();expect(registry.getActiveOrderFocus().order.items).toEqual(order.items);
 const result=await registry.execute('get_tracking',JSON.stringify({tracking_number:registry.getActiveOrderFocus().order.fulfillments[0].trackingNumber}));
 expect(result.status).toBe('ok');expect(lookup).toHaveBeenCalledOnce();
});
