export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    throw new Error('PHONE_INVALID');
  }

  if (trimmed.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }

  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
