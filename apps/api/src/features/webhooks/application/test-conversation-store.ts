type TestConversationEvent = {
  eventId: string;
  source: string;
  contactId: string;
  conversationId: string;
  message: string;
  channel: string;
};

const events: TestConversationEvent[] = [];

export function recordTestConversationEvent(event: TestConversationEvent): void {
  if (!events.some((item) => item.eventId === event.eventId)) events.push(event);
}

export function getTestConversationEvents(): TestConversationEvent[] {
  return [...events];
}

export function resetTestConversationEvents(): void {
  events.splice(0, events.length);
}
