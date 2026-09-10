import { describe, expect, it } from "vitest";
import { chooseAutomaticMailboxShop } from "../connection.js";

describe("chooseAutomaticMailboxShop", () => {
  it("auto-binds the only available shop", () => {
    const shop = { id: "shop-1", shop_domain: "example.myshopify.com" };

    expect(chooseAutomaticMailboxShop([shop])).toEqual(shop);
  });

  it("keeps the mailbox workspace-level when there is no shop", () => {
    expect(chooseAutomaticMailboxShop([])).toBeNull();
    expect(chooseAutomaticMailboxShop(null)).toBeNull();
  });

  it("does not guess when multiple shops are available", () => {
    expect(
      chooseAutomaticMailboxShop([
        { id: "shop-1", shop_domain: "one.myshopify.com" },
        { id: "shop-2", shop_domain: "two.myshopify.com" },
      ]),
    ).toBeNull();
  });
});
