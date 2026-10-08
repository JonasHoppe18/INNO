// Decides which Shopify orders the ticket panel shows and whether they belong
// to the sender. An order number in the email can match someone else's order
// (typo, guess, or a lookup fallback that searched without the email); that
// order may still be shown, but must never stand in for the sender's identity,
// previous tickets or order actions.
//
// ownership: "sender" | "other_customer" | "unverified" | "none"
export function selectLookupOrders({
  rawOrders,
  senderEmail,
  orderNumber,
  matchesEmail,
  matchesNumber,
}) {
  const orders = Array.isArray(rawOrders) ? rawOrders : [];
  const ownedBy = (order) => Boolean(senderEmail) && matchesEmail(order, senderEmail);

  if (orderNumber) {
    const numberMatches = orders.filter((order) => matchesNumber(order, orderNumber));
    const owned = numberMatches.filter(ownedBy);
    if (owned.length) {
      return {
        orders: owned.map((order) => ({ order, ownedBySender: true })),
        ownedOrders: owned,
        ownership: "sender",
      };
    }
    if (numberMatches.length) {
      return {
        orders: numberMatches.map((order) => ({
          order,
          ownedBySender: senderEmail ? false : null,
        })),
        ownedOrders: [],
        ownership: senderEmail ? "other_customer" : "unverified",
      };
    }
    return { orders: [], ownedOrders: [], ownership: "none" };
  }

  const owned = senderEmail ? orders.filter(ownedBy) : [];
  if (!owned.length) return { orders: [], ownedOrders: [], ownership: "none" };
  return {
    orders: owned.map((order) => ({ order, ownedBySender: true })),
    ownedOrders: owned,
    ownership: "sender",
  };
}
