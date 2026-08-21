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
  const vehicle = clean(data.vehicle_type) ?? 'vehículo no indicado';
  const downValue = clean(data.down_payment);
  const down = downValue ? `${downValue} de down` : 'down no indicado';
  const documents = clean(data.documents) ?? 'documentos no indicados';
  const timelineValue = clean(data.purchase_timeline);
  const timeline = timelineValue ? `quiere comprar ${timelineValue.toLowerCase()}` : 'tiempo no indicado';

  return [`${name.trim()} (${phone})`, vehicle, down, documents, timeline].join(', ') + '.';
}
