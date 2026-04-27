-- Seeds 16 default workspace_tags for every workspace that currently has 0 tags.
-- Safe to run multiple times: INSERT ... ON CONFLICT DO NOTHING is idempotent.

INSERT INTO workspace_tags (workspace_id, name, color, category, ai_prompt, is_active)
SELECT
  w.id AS workspace_id,
  t.name,
  t.color,
  t.category,
  t.ai_prompt,
  true AS is_active
FROM workspaces w
CROSS JOIN (
  VALUES
    ('Tracking',        '#3b82f6', 'Shipping', 'Customer is asking where their shipment is, wants a tracking number, or reports a delivery problem.'),
    ('Missing item',    '#3b82f6', 'Shipping', 'Customer says their parcel arrived but one or more items were missing from the package.'),
    ('Address change',  '#3b82f6', 'Shipping', 'Customer wants to change or correct the shipping address on an existing order.'),
    ('Return',          '#f97316', 'Returns',  'Customer explicitly wants to send a product back.'),
    ('Exchange',        '#f97316', 'Returns',  'Customer wants to swap for a different size or color of the same product.'),
    ('Wrong item',      '#f97316', 'Returns',  'Customer received a completely different product than what they ordered — a fulfillment error.'),
    ('Refund',          '#eab308', 'Billing',  'Customer wants their money back and has not yet initiated a return.'),
    ('Payment',         '#eab308', 'Billing',  'Billing, invoice, receipt, or failed or double charge issue.'),
    ('Fraud / dispute', '#ef4444', 'Billing',  'Customer suspects unauthorized purchase, has filed a chargeback, or reports that someone else made the purchase.'),
    ('Gift card',       '#eab308', 'Billing',  'Gift card balance, activation, redemption, or code issue.'),
    ('Cancellation',    '#64748b', 'Order',    'Customer wants to cancel an existing order.'),
    ('Product question','#8b5cf6', 'Product',  'Pre-purchase or general product information question.'),
    ('Technical support','#8b5cf6','Product',  'Product is not working and customer wants help fixing it, not replacing it.'),
    ('Warranty',        '#8b5cf6', 'Product',  'Customer is claiming a product defect under warranty and expects coverage — replacement or repair under warranty terms.'),
    ('Complaint',       '#ef4444', 'Feedback', 'Customer is expressing general dissatisfaction without a specific actionable request.'),
    ('General',         '#64748b', 'Other',    'Does not fit any of the other categories.')
) AS t(name, color, category, ai_prompt)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_tags wt WHERE wt.workspace_id = w.id
)
ON CONFLICT (workspace_id, lower(name)) DO NOTHING;
