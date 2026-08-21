'use client';

import { useEffect, useState } from 'react';

type ManualLeadForm = {
  name: string;
  phone: string;
  vehicle_type: string;
  down_payment: string;
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
};

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealerId: string;
  onLeadAdded: () => void;
}

const initialForm: ManualLeadForm = {
  name: '',
  phone: '',
  vehicle_type: '',
  down_payment: '',
  purchase_timeline: '',
  documents: '',
  identification: '',
  bank_account: '',
};

function getResponseMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = body.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return 'No se pudo guardar el lead';
}

export function AddLeadModal({ isOpen, onClose, dealerId, onLeadAdded }: AddLeadModalProps) {
  const [formData, setFormData] = useState<ManualLeadForm>(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFormData((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`/api/dealers/${dealerId}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(getResponseMessage(body));

      setFormData(initialForm);
      onClose();
      onLeadAdded();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Hubo un error de conexión');
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full rounded border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15';
  const labelClass = 'mb-1 block text-xs font-semibold text-[var(--text-muted)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(19,32,29,0.22)] sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lead-modal-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">Manual intake</p>
            <h2 id="add-lead-modal-title" className="text-lg font-semibold tracking-[-0.02em] text-[var(--text)]">Agregar lead manual</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Los campos opcionales pueden quedar vacíos.</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Cerrar" className="rounded p-1 text-xl leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50">×</button>
        </div>

        {error && <div role="alert" className="mb-4 rounded border border-[var(--error)]/30 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">{error}</div>}

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" id="manual-lead-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-lead-name" className={labelClass}>Nombre completo <span aria-hidden="true">*</span></label>
              <input id="manual-lead-name" autoFocus required name="name" value={formData.name} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label htmlFor="manual-lead-phone" className={labelClass}>Teléfono móvil <span aria-hidden="true">*</span></label>
              <input id="manual-lead-phone" required inputMode="tel" name="phone" value={formData.phone} onChange={handleChange} className={inputClass} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-lead-vehicle" className={labelClass}>Tipo de vehículo</label>
              <input id="manual-lead-vehicle" name="vehicle_type" value={formData.vehicle_type} onChange={handleChange} placeholder="p. ej. SUV" className={inputClass} />
            </div>
            <div>
              <label htmlFor="manual-lead-down" className={labelClass}>Down payment</label>
              <input id="manual-lead-down" name="down_payment" value={formData.down_payment} onChange={handleChange} placeholder="p. ej. $1,500" className={inputClass} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-lead-identification" className={labelClass}>Identificación (ID)</label>
              <input id="manual-lead-identification" name="identification" value={formData.identification} onChange={handleChange} placeholder="ID / licencia" className={inputClass} />
            </div>
            <div>
              <label htmlFor="manual-lead-bank" className={labelClass}>Cuenta bancaria</label>
              <input id="manual-lead-bank" name="bank_account" value={formData.bank_account} onChange={handleChange} placeholder="Últimos 4 dígitos" className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="manual-lead-timeline" className={labelClass}>Línea de tiempo de compra</label>
            <input id="manual-lead-timeline" name="purchase_timeline" value={formData.purchase_timeline} onChange={handleChange} placeholder="p. ej. esta semana" className={inputClass} />
          </div>

          <div>
            <label htmlFor="manual-lead-documents" className={labelClass}>Documentos disponibles</label>
            <input id="manual-lead-documents" name="documents" value={formData.documents} onChange={handleChange} placeholder="p. ej. pruebas de ingreso" className={inputClass} />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4">
            <button type="button" onClick={onClose} disabled={loading} className="rounded border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={loading} className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Guardando…' : 'Agregar lead'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
