// Normalization and change snapshots for email routing, sender rules and blocklist rows.
export const normalizeRoutingRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const id = String(row?.id || "").trim();
      const categoryKey = String(row?.category_key || "").trim().toLowerCase();
      if (!id || !categoryKey || categoryKey === "support") return null;
      return {
        id,
        category_key: categoryKey,
        label: String(row?.label || categoryKey).trim(),
        is_active: Boolean(row?.is_active),
        mode: String(row?.mode || "manual_approval") === "auto_forward" ? "auto_forward" : "manual_approval",
        forward_to_email: String(row?.forward_to_email || "").trim(),
        is_default: Boolean(row?.is_default),
        sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : index * 10 + 10,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.label || "").localeCompare(String(b.label || ""), "en", { sensitivity: "base" });
    });

export const routingSnapshot = (rows = []) =>
  JSON.stringify(
    normalizeRoutingRows(rows).map((row) => ({
      id: row.id,
      category_key: row.category_key,
      label: String(row.label || "").trim(),
      is_active: Boolean(row.is_active),
      mode: String(row.mode || "manual_approval"),
      forward_to_email: String(row.forward_to_email || "").trim().toLowerCase(),
      sort_order: Number(row.sort_order || 0),
    }))
  );

export const normalizeSenderRuleMatcherValue = (matcherType, matcherValue) => {
  const raw = String(matcherValue || "").trim().toLowerCase();
  if (!raw) return "";
  if (matcherType === "email") {
    return raw;
  }
  const domain = raw.replace(/^@+/, "");
  return domain;
};

export const normalizeSenderRuleDestinationType = (value) =>
  String(value || "").trim().toLowerCase() === "inbox" ? "inbox" : "classification";

export const normalizeSenderRuleDestinationValue = (destinationType, destinationValue) => {
  const raw = String(destinationValue || "").trim().toLowerCase();
  if (!raw) return "";
  if (destinationType === "inbox") {
    return raw
      .replace(/[^a-z0-9-_ ]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  return raw.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
};

export const normalizeSenderRuleRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || "").trim();
      const matcherType = String(row?.matcher_type || "").trim().toLowerCase() === "domain" ? "domain" : "email";
      const matcherValue = normalizeSenderRuleMatcherValue(matcherType, row?.matcher_value || "");
      const destinationType = normalizeSenderRuleDestinationType(
        row?.destination_type ||
          (String(row?.destination_key || "").startsWith("inbox:") ? "inbox" : "classification")
      );
      const rawDestinationValue =
        row?.destination_value ||
        (destinationType === "inbox"
          ? String(row?.destination_key || "").replace(/^inbox:/i, "")
          : row?.destination_key) ||
        "notification";
      const destinationValue = normalizeSenderRuleDestinationValue(destinationType, rawDestinationValue);
      if (!id) return null;
      return {
        id,
        matcher_type: matcherType,
        matcher_value: matcherValue,
        destination_type: destinationType,
        destination_value: destinationValue,
        is_active: Boolean(row?.is_active),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.matcher_value || "").localeCompare(String(b.matcher_value || ""), "en", { sensitivity: "base" }));

export const senderRulesSnapshot = (rows = []) =>
  JSON.stringify(
    normalizeSenderRuleRows(rows).map((row) => ({
      id: row.id,
      matcher_type: row.matcher_type,
      matcher_value: String(row.matcher_value || "").trim().toLowerCase(),
      destination_type: normalizeSenderRuleDestinationType(row.destination_type),
      destination_value: String(row.destination_value || "").trim().toLowerCase(),
      is_active: Boolean(row.is_active),
    }))
  );

export const normalizeBlocklistRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = String(row?.id || "").trim();
      const matcherType = String(row?.matcher_type || "").trim().toLowerCase() === "domain" ? "domain" : "email";
      const matcherValue = normalizeSenderRuleMatcherValue(matcherType, row?.matcher_value || "");
      if (!id) return null;
      return {
        id,
        matcher_type: matcherType,
        matcher_value: matcherValue,
        note: String(row?.note || "").slice(0, 300),
        is_active: Boolean(row?.is_active),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.matcher_value || "").localeCompare(String(b.matcher_value || ""), "en", { sensitivity: "base" }));

export const blocklistSnapshot = (rows = []) =>
  JSON.stringify(
    normalizeBlocklistRows(rows).map((row) => ({
      id: row.id,
      matcher_type: row.matcher_type,
      matcher_value: String(row.matcher_value || "").trim().toLowerCase(),
      note: String(row.note || "").trim(),
      is_active: Boolean(row.is_active),
    }))
  );
