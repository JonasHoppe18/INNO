import { OPERATIONAL_ACTIONS } from '../greenfield-support/operational-types';
import type { OperationalPermissions, OperationalRuntime } from '../greenfield-support/operational-types';
import type { TenantContext } from '../greenfield-support/types';
import { ShopifyReadOnlyProvider } from '../greenfield-support/shopify-read-only';
import { ShopifyOperationalProvider } from '../greenfield-support/shopify-operational';

/** A scoped server setting, never a request-body flag or model tool argument. */
export function resolveOperationalPermissions(tenant: TenantContext, configuration = process.env.GREENFIELD_OPERATIONAL_PERMISSIONS): OperationalPermissions {
  const result: OperationalPermissions = { workspaceId: tenant.workspaceId, shopId: tenant.shopId ?? '', actions: {} };
  let configured: unknown;
  try { configured = JSON.parse(configuration ?? '{}')?.[tenant.workspaceId]?.[tenant.shopId ?? '']; } catch { configured = null; }
  for (const action of OPERATIONAL_ACTIONS) {
    const setting = (configured as any)?.[action];
    result.actions[action] = { mode: ['disabled', 'hitl', 'auto'].includes(setting?.mode) ? setting.mode : 'disabled', requireConfirmation: setting?.requireConfirmation === true };
  }
  return result;
}
export function createOperationalRuntime(tenant: TenantContext, credentials: { shop_domain: string; access_token: string }, commerce: ShopifyReadOnlyProvider, channel: string): OperationalRuntime {
  const permissions = resolveOperationalPermissions(tenant);
  try { return { permissions, catalog: commerce,
    mutationProvider: new ShopifyOperationalProvider({ workspaceId: tenant.workspaceId, shopId: tenant.shopId ?? '', shopDomain: credentials.shop_domain, accessToken: credentials.access_token,
      mutationsEnabled: channel !== 'playground' && process.env.GREENFIELD_ALLOW_PROVIDER_MUTATIONS === 'true' }) }; }
  catch { return { permissions, catalog: commerce }; }
}
