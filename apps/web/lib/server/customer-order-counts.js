// Shopify's lifetime customer count is independent of the paginated order history.
export async function fetchCustomerOrderCounts(
  credentials,
  customers,
  fetchImpl = fetch,
) {
  const variables = {};
  const fields = customers.map((customer, index) => {
    const email = customer.email.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    variables[`q${index}`] = `email:"${email}"`;
    return `c${index}: customers(first: 10, query: $q${index}) {
      nodes { defaultEmailAddress { emailAddress } numberOfOrders }
      pageInfo { hasNextPage }
    }`;
  });
  const declarations = customers
    .map((_, index) => `$q${index}: String!`)
    .join(", ");
  const domain = credentials.shop_domain
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const response = await fetchImpl(
    `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": credentials.access_token,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        query: `query CustomerOrderCounts(${declarations}) { ${fields.join("\n")} }`,
        variables,
      }),
    },
  );
  if (!response.ok) throw new Error("Shopify count lookup failed");
  const payload = await response.json();
  if (payload.errors?.length) throw new Error("Shopify count lookup failed");
  return Object.fromEntries(
    customers.map((customer, index) => {
      const connection = payload.data?.[`c${index}`];
      if (
        !connection ||
        !Array.isArray(connection.nodes) ||
        connection.pageInfo?.hasNextPage !== false
      )
        return [customer.id, { status: "error" }];
      const matches = connection.nodes.filter(
        (node) =>
          String(node.defaultEmailAddress?.emailAddress || "")
            .trim()
            .toLowerCase() === customer.email,
      );
      if (matches.length > 1) return [customer.id, { status: "error" }];
      const count = matches.length ? Number(matches[0].numberOfOrders) : 0;
      if (
        (matches.length &&
          !/^\d+$/.test(String(matches[0].numberOfOrders ?? ""))) ||
        !Number.isSafeInteger(count) ||
        count < 0
      )
        return [customer.id, { status: "error" }];
      return [customer.id, { status: "checked", count }];
    }),
  );
}
