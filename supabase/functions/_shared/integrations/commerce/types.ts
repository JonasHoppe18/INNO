// Shared types for all commerce providers

export interface Address {
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  country: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export interface LineItem {
  id: string;
  title: string;
  variant_id?: string;
  quantity: number;
  price: string;
  sku?: string;
}

export interface Fulfillment {
  id: string;
  status: string;
  tracking_number?: string;
  tracking_url?: string;
  tracking_company?: string;
  shipment_status?: string;
}

export interface Order {
  id: string;
  order_number: string | number;
  name: string;           // e.g. "#1234"
  email?: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  total_price: string;
  currency: string;
  shipping_address?: Address;
  line_items: LineItem[];
  fulfillments: Fulfillment[];
  tags?: string;
  note?: string;
}

export interface TrackingInfo {
  order_id: string;
  carrier?: string;
  tracking_number?: string;
  tracking_url?: string;
  status?: string;
  status_text?: string;
  estimated_delivery?: string;
  last_event?: string;
  events?: Array<{ timestamp: string; description: string; location?: string }>;
}

export interface RefundOpts {
  amount?: number;
  reason?: string;
  note?: string;
  notify_customer?: boolean;
}

export interface RefundResult {
  id: string;
  amount: string;
  status: string;
}

export interface LineItemEdit {
  line_item_id: string;
  quantity: number;
}

export type ActionType =
  | 'cancel_order'
  | 'refund_order'
  | 'update_shipping_address'
  | 'change_shipping_method'
  | 'hold_fulfillment'
  | 'release_fulfillment'
  | 'edit_line_items'
  | 'update_customer_contact'
  | 'add_note'
  | 'add_tag'
  | 'resend_confirmation'
  | 'lookup_order_status'
  | 'fetch_tracking';

export interface CommerceProvider {
  readonly providerName: string;

  // --- Read operations ---
  getOrder(id: string): Promise<Order | null>;
  listOrdersByEmail(email: string, limit?: number): Promise<Order[]>;
  listOrdersByPhone(phone: string, limit?: number): Promise<Order[]>;
  getTracking(orderId: string): Promise<TrackingInfo[]>;

  // --- Write operations ---
  cancelOrder(id: string, opts?: { reason?: string; notifyCustomer?: boolean }): Promise<void>;
  refundOrder(id: string, opts: RefundOpts): Promise<RefundResult>;
  updateShippingAddress(id: string, address: Address): Promise<void>;
  addNote(id: string, note: string): Promise<void>;
  addTag(id: string, tag: string): Promise<void>;
  holdFulfillment(id: string): Promise<void>;
  releaseFulfillment(id: string): Promise<void>;
  editLineItems(id: string, edits: LineItemEdit[]): Promise<void>;
  updateCustomerContact(id: string, opts: { email?: string; phone?: string }): Promise<void>;

  // --- Capability check ---
  supportsAction(type: ActionType): boolean;
}
