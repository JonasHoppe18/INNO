export type AddressObject = {
  name: string;
  address1: string;
  address2?: string | null;
  zip: string;
  city: string;
  country_code: string;
  email?: string | null;
  phone?: string | null;
};

export type UpdateWebshipperAddressResult =
  | { success: true; orderId: string }
  | { success: false; reason: string };

export type CancelWebshipperOrderResult =
  | { success: true; orderId: string }
  | { success: false; reason: string };

type JsonApiError = {
  title?: string;
  detail?: string;
  code?: string;
  status?: string;
};

function buildBaseUrl(tenant: string) {
  const normalized = String(tenant || "").trim().replace(/^https?:\/\//i, "");
  return `https://${normalized}.api.webshipper.io/v2`;
}

function buildHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
}

async function parseErrorBody(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  if (!raw) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(raw);
    const errors = Array.isArray(parsed?.errors) ? (parsed.errors as JsonApiError[]) : [];
    if (errors.length) {
      const first = errors[0];
      const detail = first?.detail || first?.title || raw;
      return `HTTP ${response.status}: ${detail}`;
    }
    return `HTTP ${response.status}: ${raw}`;
  } catch {
    return `HTTP ${response.status}: ${raw}`;
  }
}

async function findWebshipperOrderId(
  baseUrl: string,
  headers: Record<string, string>,
  orderNumber: string,
): Promise<string | null> {
  const visibleRef = String(orderNumber || "").trim();
  if (!visibleRef) return null;

  const searchUrl = new URL(`${baseUrl}/orders`);
  searchUrl.searchParams.set("filter[visible_ref]", visibleRef);

  const searchResponse = await fetch(searchUrl.toString(), {
    method: "GET",
    headers,
  });
  if (!searchResponse.ok) {
    const detail = await parseErrorBody(searchResponse);
    throw new Error(`Webshipper order lookup failed. ${detail}`);
  }

  const searchPayload = await searchResponse.json().catch(() => null);
  return searchPayload?.data?.[0]?.id ? String(searchPayload.data[0].id) : null;
}

export async function updateWebshipperAddress(
  tenant: string,
  token: string,
  orderNumber: string,
  newAddress: AddressObject,
): Promise<UpdateWebshipperAddressResult> {
  const baseUrl = buildBaseUrl(tenant);
  const headers = buildHeaders(token);
  if (!String(orderNumber || "").trim()) {
    return { success: false, reason: "Order number is required" };
  }
  const orderId = await findWebshipperOrderId(baseUrl, headers, orderNumber);
  if (!orderId) {
    return { success: false, reason: "Order not found in Webshipper" };
  }

  const patchUrl = `${baseUrl}/orders/${orderId}`;
  const patchBody = {
    data: {
      id: orderId,
      type: "orders",
      attributes: {
        delivery_address: {
          att_contact: newAddress.name,
          address_1: newAddress.address1,
          address_2: newAddress.address2 ?? null,
          zip: newAddress.zip,
          city: newAddress.city,
          country_code: newAddress.country_code,
          email: newAddress.email ?? null,
          phone: newAddress.phone ?? null,
        },
      },
    },
  };

  const patchResponse = await fetch(patchUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patchBody),
  });
  if (!patchResponse.ok) {
    const detail = await parseErrorBody(patchResponse);
    throw new Error(`Webshipper address update failed for order ${orderId}. ${detail}`);
  }

  return { success: true, orderId };
}

export async function cancelWebshipperOrder(
  tenant: string,
  token: string,
  orderNumber: string,
): Promise<CancelWebshipperOrderResult> {
  const baseUrl = buildBaseUrl(tenant);
  const headers = buildHeaders(token);

  if (!String(orderNumber || "").trim()) {
    return { success: false, reason: "Order number is required" };
  }

  const orderId = await findWebshipperOrderId(baseUrl, headers, orderNumber);
  if (!orderId) {
    return { success: false, reason: "Order not found in Webshipper" };
  }

  const patchUrl = `${baseUrl}/orders/${orderId}`;
  const statusCandidates = ["cancelled", "canceled"];
  let lastError = "";

  for (const status of statusCandidates) {
    const patchBody = {
      data: {
        id: orderId,
        type: "orders",
        attributes: {
          status,
        },
      },
    };

    const response = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patchBody),
    });

    if (response.ok) {
      return { success: true, orderId };
    }

    lastError = await parseErrorBody(response);
  }

  throw new Error(`Webshipper cancel failed for order ${orderId}. ${lastError}`);
}
