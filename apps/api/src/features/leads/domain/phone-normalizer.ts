export function normalizePhone(phone: unknown): string {
  if (typeof phone !== 'string') {
    throw new Error('PHONE_INVALID');
  }

  const trimmed = phone.trim();
  if (!trimmed || /[^\d\s().+\-]/.test(trimmed)) {
    throw new Error('PHONE_INVALID');
  }

  const digits = trimmed.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    throw new Error('PHONE_INVALID');
  }

  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  if (trimmed.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }

  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function normalizePhoneOrNull(phone: unknown): string | null {
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}
