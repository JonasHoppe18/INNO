const CUSTOMER_NAME_LABELS = new Set(["den skal sendes til", "ships to", "ship to"]);

export function isCustomerNameLabel(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[.:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return CUSTOMER_NAME_LABELS.has(normalized);
}

export function getCustomerDisplayName({ customer = {}, shippingName = "", fallbackEmail = "" } = {}) {
  return [
    customer?.name,
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" "),
    shippingName,
    fallbackEmail,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find((value) => value && !isCustomerNameLabel(value)) || "Unknown customer";
}
