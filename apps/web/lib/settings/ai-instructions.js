// After a save, show the stored prompt unless the user kept typing while it was in flight.
export function draftAfterSave({ draft, submitted, saved }) {
  return draft === submitted ? saved : draft;
}
