import type { CommerceReadProvider, OrderSnapshot, TenantContext } from './types';
export const OPERATIONAL_ACTIONS = ['cancel_order', 'update_address', 'update_order_line'] as const;
export type OperationalAction = typeof OPERATIONAL_ACTIONS[number];
export type MerchantExecutionMode = 'disabled' | 'hitl' | 'auto';
export interface OperationalPermissions {
  workspaceId: string;
  shopId: string;
  actions: Partial<Record<OperationalAction, { mode: MerchantExecutionMode; requireConfirmation?: boolean }>>;
}
export interface DeliveryAddress {
  address1: string;
  address2?: string;
  city: string;
  zip: string;
  countryCode: string;
  provinceCode?: string;
}
export interface CatalogVariant {
  id: string;
  productId: string;
  title: string;
  options: string[];
  price: string | null;
  currency: string | null;
  availableQuantity: number | null;
  availability: 'available' | 'unavailable' | 'unknown';
}
export interface OperationalCatalogProvider {
  getOrderLineVariants(productId: string): Promise<CatalogVariant[]>;
}
export interface OperationalMutationProvider {
  scope: { workspaceId: string; shopId: string };
  readonly mutationsEnabled: boolean;
  supports(action: OperationalAction): boolean;
  mutate(command: OperationalCommand): Promise<{ accepted: boolean; error?: string }>;
}
export interface OperationalCommand {
  action: OperationalAction;
  orderId: string;
  orderReference: string;
  customerEmail: string;
  reason: string;
  address?: DeliveryAddress;
  addressText?: string;
  lineId?: string;
  variantId?: string;
  quantity?: number;
  expectedLineValue?: string;
  currency?: string;
}
export interface PriceImpact {
  currency: string;
  oldLineValue: string;
  newLineValue: string;
  delta: string;
  acceptanceRequired: boolean;
  paymentRequired: boolean;
  refundHandlingRequired: boolean;
}
export interface OperationalOutcome {
  workspaceId: string;
  shopId: string;
  caseId: string | null;
  customerEmail: string;
  action: OperationalAction;
  mode: 'simulated' | 'auto' | 'hitl' | 'blocked';
  status: 'SIMULATED' | 'EXECUTED' | 'PROPOSED' | 'BLOCKED';
  command: OperationalCommand | null;
  eligible: boolean;
  permission: MerchantExecutionMode;
  providerCapable: boolean;
  executed: boolean;
  providerMutationAttempted: boolean;
  readBackVerified: boolean;
  before: OrderSnapshot | null;
  after: OrderSnapshot | null;
  requirements: Array<{ name: string; owner: 'customer' | 'human' | 'live_data'; satisfied: boolean }>;
  priceImpact: PriceImpact | null;
  lineContext: Record<string, unknown> | null;
  reason: string;
  question: string | null;
}
export interface OperationalRuntime {
  permissions: OperationalPermissions;
  mutationProvider?: OperationalMutationProvider;
  catalog?: OperationalCatalogProvider;
}
export interface OperationalRequest {
  tenant: TenantContext;
  commerce: CommerceReadProvider;
  runtime: OperationalRuntime;
  channel?: string;
}
