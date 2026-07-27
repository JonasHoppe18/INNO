export function chooseAutomaticMailboxShop(shops) {
  const scopedShops = Array.isArray(shops) ? shops.filter((shop) => shop?.id) : [];
  return scopedShops.length === 1 ? scopedShops[0] : null;
}
