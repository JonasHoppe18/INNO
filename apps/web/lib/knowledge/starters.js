// Suggested "customer question" starters shown in the empty state of each
// snippet view. The point is to remove the blank-page paralysis — clicking a
// starter pre-fills the SnippetEditor with the question + Guide type so the
// admin only has to write the answer.

const PRODUCT_STARTERS = (title) => [
  `How do I pair my ${title} with my device?`,
  `How do I update the firmware on my ${title}?`,
  `How do I factory reset my ${title}?`,
  `What's covered by the warranty on my ${title}?`,
  `My ${title} won't turn on — what do I do?`,
];

const GENERAL_PRODUCT_STARTERS = [
  "What is your return policy?",
  "How long does delivery take?",
  "How do I track my order?",
  "Do you ship internationally?",
  "How do I contact support?",
];

const RETURN_STARTERS = [
  "How do I return a damaged item?",
  "What's the return shipping cost?",
  "Can I exchange instead of refund?",
  "How long does a refund take to process?",
  "Do I need the original packaging to return an item?",
];

const SHIPPING_STARTERS = [
  "When will my order ship?",
  "How long does delivery take to my country?",
  "Why hasn't my tracking updated?",
  "What happens if my package is lost?",
  "Can I change my shipping address after ordering?",
];

const GENERAL_STARTERS = [
  "What are your opening hours?",
  "How do I contact customer support?",
  "Where is your office located?",
  "Do you offer business / B2B pricing?",
  "How do I unsubscribe from your newsletter?",
];

export function buildStarters({ category, productTitle, productScope } = {}) {
  if (category === "returns") return RETURN_STARTERS;
  if (category === "shipping") return SHIPPING_STARTERS;
  if (category === "general") return GENERAL_STARTERS;
  // Default = product-questions
  if (productTitle && productScope !== "general") {
    return PRODUCT_STARTERS(productTitle);
  }
  return GENERAL_PRODUCT_STARTERS;
}
