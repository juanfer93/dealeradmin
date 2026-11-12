import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ConversationViewerModal } from './ConversationViewerModal';

const lead = {
  id: 'lead-1', dealerId: 'dealer-1', dealerName: 'Dealer', name: 'Ana Lopez', phone: '+15551234567',
  vehicleType: 'SUV', downPayment: null, identification: null, bankAccount: null, documents: null,
  purchaseTimeline: null, status: 'sent' as const, messageText: '', createdAt: '2026-11-01T10:00:00Z',
};

describe('ConversationViewerModal', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders a queued WhatsApp conversation with incoming and outgoing messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ conversations: [{
      id: 'conversation-1', channel: 'whatsapp', status: 'queued', firstMessageAt: null, lastMessageAt: '2026-11-01T10:02:00Z',
      messages: [
        { id: 'message-1', direction: 'inbound', body: 'Hola, busco una camioneta.', occurredAt: '2026-11-01T10:00:00Z' },
        { id: 'message-2', direction: 'outbound', body: '¿Qué presupuesto tienes?', occurredAt: '2026-11-01T10:02:00Z' },
      ],
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { container } = render(<ConversationViewerModal lead={lead} language="es" close={() => undefined} />);
    expect(await screen.findByText('Hola, busco una camioneta.')).toBeInTheDocument();
    expect(screen.getByText('¿Qué presupuesto tienes?')).toBeInTheDocument();
    expect(screen.getByText('En cola · calificación completa')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('div')).some((node) => node.className.includes('bg-[#d9fdd3]'))).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/leads/lead-1/conversation?dealerId=dealer-1', expect.anything());
  });
});
