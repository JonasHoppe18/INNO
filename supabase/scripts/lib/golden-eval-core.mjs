// supabase/scripts/lib/golden-eval-core.mjs
export const ACEZONE_SHOP_ID = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";

export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  const tier = val("--tier");
  if (tier !== null && tier !== "historical" && tier !== "edge") {
    throw new Error('tier must be "historical" or "edge"');
  }
  const limitRaw = val("--limit");
  return {
    shop: val("--shop") || ACEZONE_SHOP_ID,
    tier,
    limit: limitRaw !== null ? parseInt(limitRaw, 10) : null,
    accept: has("--accept"),
  };
}
