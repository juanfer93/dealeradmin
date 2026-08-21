export type MessageLeadData = {
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
};

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildWhatsAppMessage(name: string, phone: string, data: MessageLeadData): string {
  const vehicle = clean(data.vehicle_type) ?? '';
  const downValue = clean(data.down_payment);
  const down = downValue ? `${downValue} de down` : '';
  const documents = clean(data.documents) ?? '';
  const timelineValue = clean(data.purchase_timeline);
  const timeline = timelineValue ? `quiere comprar ${timelineValue.toLowerCase()}` : '';

  const identity = [name.trim(), phone, vehicle].filter(Boolean).join(' ');
  return [identity, down, documents, timeline].filter(Boolean).join(', ') + '.';
}
