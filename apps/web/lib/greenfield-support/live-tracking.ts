import type { LiveTrackingSnapshot } from './types';
export function normalizedShipmentState(value: string | null): string {
  const token = String(value ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  const states: Record<string, string> = { pending: 'pre_transit', info_received: 'pre_transit', inforeceived: 'pre_transit', pretransit: 'pre_transit', intransit: 'in_transit', transit: 'in_transit', outfordelivery: 'out_for_delivery', delivered: 'delivered', exception: 'exception', failed: 'exception', deliveryfailed: 'exception' };
  return states[token] ?? 'unknown';
}
export function normalizeLiveShipment(snapshot: LiveTrackingSnapshot): LiveTrackingSnapshot {
  return { ...snapshot, status: normalizedShipmentState(snapshot.status), latestEvent: snapshot.latestEvent ? { ...snapshot.latestEvent } : null };
}
