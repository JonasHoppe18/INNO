import { describe, expect, it } from "vitest";
import { selectLookupOrders } from "../customer-lookup-selection.js";

const order = (number, email) => ({ order_number: number, name: `#${number}`, email });
const byEmail = (o, email) => String(o.email || "").toLowerCase() === String(email || "").toLowerCase();
const byNumber = (o, n) => String(o.order_number) === String(n);
const select = (args) =>
  selectLookupOrders({ matchesEmail: byEmail, matchesNumber: byNumber, ...args });

describe("selectLookupOrders", () => {
  it("uses the sender's order when the mentioned order belongs to them", () => {
    const result = select({
      rawOrders: [order(1001, "anna@shop.dk")],
      senderEmail: "anna@shop.dk",
      orderNumber: "1001",
    });
    expect(result.ownership).toBe("sender");
    expect(result.orders).toEqual([{ order: order(1001, "anna@shop.dk"), ownedBySender: true }]);
    expect(result.ownedOrders).toHaveLength(1);
  });

  it("keeps another customer's order visible but never treats it as the sender's", () => {
    const result = select({
      rawOrders: [order(1001, "someone@else.dk")],
      senderEmail: "anna@shop.dk",
      orderNumber: "1001",
    });
    expect(result.ownership).toBe("other_customer");
    expect(result.orders[0].ownedBySender).toBe(false);
    expect(result.ownedOrders).toEqual([]);
  });

  it("prefers the sender-owned match when an order number matches several orders", () => {
    const result = select({
      rawOrders: [order(1001, "someone@else.dk"), order(1001, "anna@shop.dk")],
      senderEmail: "anna@shop.dk",
      orderNumber: "1001",
    });
    expect(result.ownership).toBe("sender");
    expect(result.orders.map((row) => row.order.email)).toEqual(["anna@shop.dk"]);
  });

  it("marks an order-number match as unverified when there is no sender email", () => {
    const result = select({ rawOrders: [order(1001, "x@y.dk")], senderEmail: "", orderNumber: "1001" });
    expect(result.ownership).toBe("unverified");
    expect(result.orders[0].ownedBySender).toBeNull();
    expect(result.ownedOrders).toEqual([]);
  });

  it("returns only the sender's orders when no order number is mentioned", () => {
    const result = select({
      rawOrders: [order(1, "anna@shop.dk"), order(2, "other@x.dk")],
      senderEmail: "anna@shop.dk",
      orderNumber: null,
    });
    expect(result.ownership).toBe("sender");
    expect(result.orders.map((row) => row.order.order_number)).toEqual([1]);
  });

  it("reports none when nothing matches", () => {
    const result = select({ rawOrders: [], senderEmail: "anna@shop.dk", orderNumber: "1001" });
    expect(result).toEqual({ orders: [], ownedOrders: [], ownership: "none" });
  });
});
