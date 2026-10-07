import type { OperationalAction, OperationalCommand, OperationalMutationProvider } from './operational-types';
export const CANCEL_ORDER_MUTATION = `mutation CancelOrder($orderId: ID!) { orderCancel(orderId: $orderId, reason: CUSTOMER, restock: false, notifyCustomer: false) { job { id done } orderCancelUserErrors { field message code } } }`;
export const UPDATE_ADDRESS_MUTATION = `mutation UpdateAddress($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`;

/** Separate write adapter; constructing it does not authorize a mutation. */
export class ShopifyOperationalProvider implements OperationalMutationProvider {
  readonly scope: { workspaceId: string; shopId: string };
  readonly mutationsEnabled: boolean;
  private readonly endpoint: string;
  constructor(private readonly options: { workspaceId: string; shopId: string; shopDomain: string; accessToken: string; mutationsEnabled?: boolean; apiVersion?: string; fetchImpl?: typeof fetch }) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(options.shopDomain)) throw new Error('Invalid Shopify domain');
    this.scope = { workspaceId: options.workspaceId, shopId: options.shopId };
    this.mutationsEnabled = options.mutationsEnabled === true;
    this.endpoint = `https://${options.shopDomain}/admin/api/${options.apiVersion ?? '2026-07'}/graphql.json`;
  }
  supports(action: OperationalAction): boolean { return action === 'cancel_order' || action === 'update_address'; }
  async mutate(command: OperationalCommand): Promise<{ accepted: boolean; error?: string }> {
    if (!this.mutationsEnabled) return { accepted: false, error: 'provider_mutations_disabled' };
    if (!this.supports(command.action)) return { accepted: false, error: 'provider_capability_unavailable' };
    const id = /^\d+$/.test(command.orderId) ? `gid://shopify/Order/${command.orderId}` : command.orderId;
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id)) return { accepted: false, error: 'invalid_order_id' };
    if (command.action === 'update_address' && !command.address) return { accepted: false, error: 'structured_address_required' };
    const query = command.action === 'cancel_order' ? CANCEL_ORDER_MUTATION : UPDATE_ADDRESS_MUTATION;
    const variables = command.action === 'cancel_order' ? { orderId: id } : { input: { id, shippingAddress: command.address } };
    const response = await (this.options.fetchImpl ?? fetch)(this.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': this.options.accessToken }, body: JSON.stringify({ query, variables }) });
    if (!response.ok) return { accepted: false, error: 'provider_http_error' };
    const data = await response.json();
    const payload = command.action === 'cancel_order' ? data.data?.orderCancel : data.data?.orderUpdate;
    if (data.errors?.length || !payload || (payload.orderCancelUserErrors ?? payload.userErrors ?? []).length) return { accepted: false, error: 'provider_rejected_action' };
    if (command.action === 'cancel_order' ? !payload.job?.id : payload.order?.id !== id) return { accepted: false, error: 'provider_response_not_bound' };
    return { accepted: true };
  }
}
