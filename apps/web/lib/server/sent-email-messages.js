import { markConfirmationMessages } from "./confirmation-messages";
import { markCsatSentEvent } from "./csat-messages";

export async function markSentEmailMessages(client, messages, scope) {
  const [confirmations, surveys] = await Promise.all([
    markConfirmationMessages(client, messages, scope),
    markCsatSentEvent(client, messages, scope),
  ]);
  return confirmations.map((message, index) =>
    surveys[index]?.csat_sent_event
      ? { ...message, csat_sent_event: surveys[index].csat_sent_event }
      : message,
  );
}
