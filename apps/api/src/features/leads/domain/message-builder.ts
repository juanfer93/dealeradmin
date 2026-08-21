export type MessageLeadData = {
  vehicle_type?: string | null;
  down_payment?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  purchase_timeline?: string | null;
};

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildWhatsAppMessage(name: string, phone: string, data: MessageLeadData): string {
  const vehicle = clean(data.vehicle_type) ?? '';
  const downValue = clean(data.down_payment);
  const down = downValue ? `${downValue} de down` : '';
  const identificationValue = clean(data.identification);
  const identification = identificationValue ? `ID ${identificationValue}` : '';
  const bankAccountValue = clean(data.bank_account);
  const bankAccount = bankAccountValue ? `cuenta bancaria ${bankAccountValue}` : '';
  const timelineValue = clean(data.purchase_timeline);
  const timeline = timelineValue ? `quiere comprar ${timelineValue.toLowerCase()}` : '';

  const identity = [name.trim(), phone, vehicle].filter(Boolean).join(' ');
  return [identity, down, identification, bankAccount, timeline].filter(Boolean).join(', ') + '.';
}
