import { resolveCatalogIdentity } from "./catalog-identity";
import { actionEligibility } from './action-eligibility';
import type { ConversationContext, OrderSnapshot, ProposedAction } from './types';
import type { TurnIR } from './turn-ir';
import type { CatalogVariant, DeliveryAddress, OperationalAction, OperationalCommand, OperationalOutcome, OperationalRequest, PriceImpact } from './operational-types';

const ref = (value: unknown) => String(value ?? '').trim().replace(/^#/, '').toLowerCase();
const email = (value: unknown) => String(value ?? '').trim().toLowerCase();
const orderMatches = (order: OrderSnapshot, value: string) => [order.id, order.orderNumber].some(id => ref(id) === ref(value));

/** Decimal money stays integer-valued until formatting; no floating-point price decisions. */
export function moneyMinor(value: string | null | undefined, currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const match = String(value ?? '').match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > digits) return null;
  const number = Number(match[2]) * 10 ** digits + Number((match[3] ?? '').padEnd(digits, '0'));
  return Number.isSafeInteger(number) ? (match[1] ? -number : number) : null;
}
function money(value: number, currency: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return (value / 10 ** digits).toFixed(digits);
}
export function linePriceImpact(order: OrderSnapshot, line: NonNullable<OrderSnapshot['items']>[number], variant: CatalogVariant, quantity: number): PriceImpact | null {
  if (!order.currency || order.currency !== variant.currency) return null;
  const current = moneyMinor(line.unitPrice, order.currency), next = moneyMinor(variant.price, order.currency);
  const discount = moneyMinor(line.totalDiscount ?? '0', order.currency);
  if (current === null || next === null || discount === null || current < 0 || next < 0 || discount < 0) return null;
  const oldValue = current * line.quantity - discount, newValue = next * quantity;
  if (![oldValue, newValue].every(Number.isSafeInteger) || oldValue < 0) return null;
  const delta = newValue - oldValue;
  return { currency: order.currency, oldLineValue: money(oldValue, order.currency), newLineValue: money(newValue, order.currency), delta: money(delta, order.currency), acceptanceRequired: delta > 0, paymentRequired: delta > 0, refundHandlingRequired: delta < 0 };
}

function validAddress(address: DeliveryAddress | undefined): boolean {
  return Boolean(address && address.address1.trim() && address.city.trim() && address.zip.trim() && /^[A-Z]{2}$/.test(address.countryCode));
}
export function expectedOperationalState(command: OperationalCommand, order: OrderSnapshot): boolean {
  if (command.action === 'cancel_order') return ['cancelled', 'canceled'].includes(ref(order.status));
  if (command.action === 'update_address') {
    if (command.address) return Object.entries(command.address).every(([key, value]) => String(order.shippingAddress?.[key] ?? '').trim().toLowerCase() === String(value).trim().toLowerCase());
    return Boolean(command.addressText && order.shippingAddress?.formatted === command.addressText);
  }
  const line = order.items?.find(item => item.id === command.lineId);
  if (!line || line.variantId !== command.variantId || line.quantity !== command.quantity || order.currency !== command.currency) return false;
  const unit = moneyMinor(line.unitPrice, command.currency ?? ''), discount = moneyMinor(line.totalDiscount ?? '0', command.currency ?? '');
  return unit !== null && discount !== null && unit * line.quantity - discount === moneyMinor(command.expectedLineValue, command.currency ?? '');
}
function simulatedState(command: OperationalCommand, before: OrderSnapshot): OrderSnapshot {
  const after = structuredClone(before);
  if (command.action === 'cancel_order') after.status = 'cancelled';
  if (command.action === 'update_address') after.shippingAddress = command.address ? { ...command.address } : { formatted: command.addressText! };
  if (command.action === 'update_order_line') after.items = after.items?.map(item => item.id === command.lineId ? { ...item, variantId: command.variantId, quantity: command.quantity! } : item);
  return after;
}
function lineDispatched(order: OrderSnapshot, lineId: string): boolean {
  const status = ref(order.fulfillmentStatus ?? order.status);
  if (['fulfilled', 'shipped', 'delivered', 'in_transit'].includes(status)) return true;
  if (order.fulfillmentStatus && !['unfulfilled', 'partial'].includes(status)) return true;
  const active = (order.fulfillments ?? []).filter(f => !['cancelled', 'canceled', 'failure', 'failed'].includes(ref(f.status)));
  if (active.some(f => f.itemMappingStatus !== 'verified' || !f.items.length || f.items.some(item => !order.items?.some(line => line.id === item.orderLineItemId) || !Number.isSafeInteger(item.quantity) || item.quantity < 0))) return active.length > 0;
  if (status === 'partial' && !active.length) return true;
  return active.some(f => f.items.some(item => item.orderLineItemId === lineId && item.quantity > 0));
}

/** The model supplies meaning. Fresh providers, scoped permission and code decide every transition. */
export async function resolveOperationalAction(request: OperationalRequest, context: ConversationContext, ir: TurnIR | null): Promise<OperationalOutcome | null> {
  if (!ir || !request.tenant.customerEmail || !context.activeOrder) return null;
  const intent = ir.actions.find(action => ['cancel_order', 'update_address', 'update_order_line'].includes(action.action));
  if (!intent) return null;
  const action = intent.action as OperationalAction, tenant = request.tenant, state = context.caseState;
  const config = request.runtime.permissions;
  const permission = config.actions[action]?.mode ?? 'disabled';
  const result: OperationalOutcome = { workspaceId: tenant.workspaceId, shopId: tenant.shopId ?? '', caseId: tenant.caseId ?? null, customerEmail: email(tenant.customerEmail), action, mode: 'blocked', status: 'BLOCKED', command: null, eligible: false, permission, providerCapable: request.runtime.mutationProvider?.supports(action) === true, executed: false, providerMutationAttempted: false, readBackVerified: false, before: null, after: null, requirements: [], priceImpact: null, lineContext: null, reason: '', question: null };
  const stop = (reason: string, owner: 'customer' | 'human' | 'live_data' = 'human', question: string | null = null) => {
    result.reason = reason; result.question = question;
    result.requirements.push({ name: reason, owner, satisfied: false });
    if (owner === 'human') { result.mode = 'hitl'; result.status = 'PROPOSED'; }
    return result;
  };
  const bound = state && state.scope.workspaceId === tenant.workspaceId && state.scope.shopId === tenant.shopId
    && (!tenant.caseId || state.scope.caseId === tenant.caseId) && email(state.scope.customerEmail) === email(tenant.customerEmail) && !state.identityUnavailable;
  if (!bound || config.workspaceId !== tenant.workspaceId || config.shopId !== tenant.shopId) return stop('scope_mismatch', 'live_data');
  if (intent.orderReference && !orderMatches(context.activeOrder.order ?? { id: '', orderNumber: context.activeOrder.requestedOrderId, status: '' }, intent.orderReference)) return stop('intent_order_mismatch', 'live_data');
  let before: OrderSnapshot | null;
  try {
    const customer = await request.commerce.getCustomer();
    if (email(customer?.email) !== email(tenant.customerEmail)) return stop('customer_identity_mismatch', 'live_data');
    before = await request.commerce.getOrder(context.activeOrder.requestedOrderId);
  } catch { return stop('current_order_unavailable', 'live_data'); }
  if (!before || !orderMatches(before, context.activeOrder.requestedOrderId) || (before.customerEmail && email(before.customerEmail) !== email(tenant.customerEmail))) return stop('order_scope_mismatch', 'live_data');
  before = structuredClone(before);
  result.before = before;
  const command: OperationalCommand = { action, orderId: before.id, orderReference: before.orderNumber, customerEmail: email(tenant.customerEmail), reason: intent.sourceText };
  result.command = command;
  if (action !== 'update_order_line') {
    const proposal = { action, arguments: { order_id: before.orderNumber, reason: intent.sourceText }, reason: intent.sourceText, requiresConfirmation: false, status: 'proposed' } as ProposedAction;
    const eligibility = actionEligibility(proposal, { tenant, verifiedWorkspaceId: tenant.workspaceId, activeOrder: { state: 'verified', requestedOrderId: before.orderNumber, order: before }, manifest: { readTools: [], proposalOnlyTools: [action], configured: { commerce: true, knowledge: false, tracking: false } } });
    if (!eligibility.eligible) return stop('fulfillment_or_order_state_blocks_action', 'live_data');
    if (action === 'update_address') {
      const supplied = state.address;
      if (!supplied?.complete || ref(supplied.orderReference) !== ref(context.activeOrder.requestedOrderId)) return stop('new_address_required', 'customer', 'What is the complete new delivery address?');
      command.addressText = supplied.value;
      if (validAddress(supplied.details)) command.address = { ...supplied.details, address2: supplied.details!.address2 ?? '' };
    }
  } else {
    const change = state.lineChange ?? ir.lineChange;
    if (!change) return stop('line_change_required', 'customer', 'Which item and change do you mean?');
    const lines = (before.items ?? []).filter(line => !change.sourceItem || resolveCatalogIdentity(change.sourceItem, [{ id: line.productId ?? line.id, title: line.title, variants: [{ id: line.variantId ?? line.id, title: line.variantTitle ?? "Default" }] }]).length > 0);
    if (lines.length !== 1) return stop('source_line_ambiguous', 'customer', `Which order item do you mean: ${(before.items ?? []).map(line => line.title + (line.variantTitle ? ` (${line.variantTitle})` : '')).join(' or ')}?`);
    const line = lines[0]; command.lineId = line.id;
    result.lineContext = { order: before.orderNumber, line: { ...line }, fulfillmentState: before.fulfillmentStatus ?? before.status, requestedVariant: change.targetVariant ?? null, requestedQuantity: change.quantity ?? line.quantity };
    if (!line.productId || !request.runtime.catalog) return stop('live_catalog_unavailable', 'live_data');
    let variants: CatalogVariant[];
    try { variants = await request.runtime.catalog.getOrderLineVariants(line.productId); } catch { return stop('live_catalog_unavailable', 'live_data'); }
    variants = variants.filter(v => v.productId === line.productId);
    const matchingVariants = change.targetVariant ? resolveCatalogIdentity(`${line.title} ${change.targetVariant}`, [{ id: line.productId, title: line.title, variants: variants.map(v => ({ id: v.id, title: v.title, option1: v.options[0], option2: v.options[1], option3: v.options[2] })) }]).flatMap(match => match.variants.map(v => String(v.id))) : [line.variantId];
    const targets = variants.filter(v => matchingVariants.includes(v.id));
    if (targets.length !== 1) return stop(targets.length ? 'target_variant_ambiguous' : 'target_variant_unknown', 'customer', targets.length ? `Which target variant do you mean: ${targets.map(v => v.title).join(' or ')}?` : 'Which available product variant do you want?');
    const target = targets[0], quantity = change.quantity ?? line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1) return stop('unsupported_quantity', 'human');
    command.variantId = target.id; command.quantity = quantity;
    result.lineContext = { ...result.lineContext, target: { ...target } };
    result.priceImpact = linePriceImpact(before, line, target, quantity);
    if (result.priceImpact) { command.expectedLineValue = result.priceImpact.newLineValue; command.currency = result.priceImpact.currency; }
    if (!before.status || ['unknown', 'closed', 'cancelled', 'canceled'].includes(ref(before.status)) || lineDispatched(before, line.id)) return stop('affected_line_fulfilled_or_state_unknown', 'live_data');
    const needed = target.id === line.variantId ? Math.max(0, quantity - line.quantity) : quantity;
    if (needed > 0 && (target.availability !== 'available' || target.availableQuantity === null || target.availableQuantity < needed)) return stop('target_inventory_unavailable', 'live_data');
    if (!result.priceImpact) return stop('price_impact_unknown');
    if (result.priceImpact.paymentRequired) return stop('payment_and_acceptance_required');
    if (result.priceImpact.refundHandlingRequired) return stop('refund_handling_requires_authorization');
  }
  result.eligible = true;
  if (permission === 'disabled') { result.status = 'BLOCKED'; result.mode = 'blocked'; result.reason = 'merchant_permission_disabled'; result.requirements.push({ name: result.reason, owner: 'human', satisfied: false }); return result; }
  const provider = request.runtime.mutationProvider;
  if (!provider || provider.scope.workspaceId !== tenant.workspaceId || provider.scope.shopId !== tenant.shopId) return stop('mutation_provider_scope_unavailable');
  if (!provider.supports(action)) return stop('provider_capability_unavailable');
  if (permission === 'hitl') return stop('merchant_approval_required');
  if (config.actions[action]?.requireConfirmation && !(state.actionConfirmation?.action === action && ref(state.actionConfirmation.orderReference) === ref(context.activeOrder.requestedOrderId))) return stop('merchant_confirmation_required', 'customer', 'Please confirm the requested change.');
  if (request.channel === 'playground') {
    result.mode = 'simulated'; result.after = simulatedState(command, before);
    result.readBackVerified = expectedOperationalState(command, result.after);
    result.status = result.readBackVerified ? 'SIMULATED' : 'BLOCKED'; result.reason = result.readBackVerified ? 'simulated_read_back_verified' : 'simulated_read_back_failed';
    return result;
  }
  if (!['support_inbox', 'support_email'].includes(request.channel ?? '')) return stop('channel_execution_not_enabled');
  if (!provider.mutationsEnabled) return stop('provider_mutations_disabled');
  if (action === 'update_address' && !command.address) return stop('structured_address_unavailable');
  // Recheck after catalog/permission work, immediately before the one permitted write.
  try {
    const current = await request.commerce.getOrder(before.id);
    const fingerprint = (order: OrderSnapshot) => JSON.stringify({ id: order.id, number: order.orderNumber, customer: order.customerEmail, status: order.status, fulfillment: order.fulfillmentStatus, fulfillments: order.fulfillments, items: order.items, currency: order.currency, address: order.shippingAddress });
    if (!current || fingerprint(current) !== fingerprint(before)) return stop('order_changed_before_execution', 'live_data');
  } catch { return stop('pre_execution_read_failed', 'live_data'); }
  result.mode = 'auto'; result.providerMutationAttempted = true;
  try {
    const accepted = await provider.mutate(command);
    if (!accepted.accepted) return stop(accepted.error ?? 'provider_rejected_action');
    const after = await request.commerce.getOrder(before.id);
    if (!after || !orderMatches(after, before.id) || after.orderNumber !== before.orderNumber || (after.customerEmail && email(after.customerEmail) !== email(tenant.customerEmail))) return stop('read_back_scope_mismatch', 'live_data');
    result.after = structuredClone(after); result.readBackVerified = expectedOperationalState(command, after);
    if (!result.readBackVerified) return stop('read_back_did_not_verify_change', 'live_data');
    result.executed = true; result.status = 'EXECUTED'; result.reason = 'provider_read_back_verified';
    return result;
  } catch { return stop('mutation_or_read_back_failed', 'live_data'); }
}

export function operationalReply(result: OperationalOutcome, locale = 'en'): string {
  const action = result.action === 'cancel_order' ? 'cancelled' : result.action === 'update_address' ? 'updated with the new delivery address' : 'updated with the requested item change';
  if ((result.status === 'SIMULATED' || result.status === 'EXECUTED') && result.readBackVerified) {
    const prefix = result.status === 'SIMULATED' ? (locale === 'da' ? 'Simuleret resultat: ' : 'Simulated result: ') : '';
    return `${prefix}Order #${result.command!.orderReference} has been ${action}.${result.status === 'SIMULATED' ? ' No live order was changed.' : ''}`;
  }
  if (result.question) return result.question;
  if (result.priceImpact?.paymentRequired) return 'This change increases the order value. Payment and acceptance require human review; the change is not confirmed.';
  if (result.priceImpact?.refundHandlingRequired) return 'This change reduces the order value. Refund handling requires human review; no refund or item change is confirmed.';
  if (result.status === 'PROPOSED') return 'The requested change requires human review with the verified order details. Completion has not been confirmed.';
  if (result.providerMutationAttempted) return 'The provider change could not be verified. Completion is not confirmed; this requires review.';
  return 'The requested change is unavailable for the verified order or current permissions. No change was made.';
}

export function isVerifiedOperationalOutcome(result: OperationalOutcome): boolean {
  if (!result || !['SIMULATED','EXECUTED','PROPOSED','BLOCKED'].includes(result.status) || !result.workspaceId || !result.shopId || !result.customerEmail) return false;
  if (!['SIMULATED','EXECUTED'].includes(result.status)) return !result.executed && !result.readBackVerified;
  if (!result.command || !result.before || !result.after || !result.eligible || result.permission !== 'auto' || !result.providerCapable || !result.readBackVerified) return false;
  if (result.before.id !== result.command.orderId || result.after.id !== result.before.id || result.after.orderNumber !== result.before.orderNumber || !expectedOperationalState(result.command,result.after)) return false;
  return result.status === 'SIMULATED' ? result.mode === 'simulated' && !result.executed && !result.providerMutationAttempted : result.mode === 'auto' && result.executed && result.providerMutationAttempted;
}
