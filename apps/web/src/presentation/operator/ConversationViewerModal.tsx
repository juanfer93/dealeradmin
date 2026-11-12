'use client';

import React, { useEffect, useState } from 'react';
import type { Lead, LeadConversation } from '../../domain/leads/lead.types';
import { getLeadConversation } from '../../infrastructure/operator/operator-api';
import type { Language } from '../../lib/i18n';

type Props = { lead: Lead; language: Language; close: () => void };

export function ConversationViewerModal({ lead, language, close }: Props) {
  const [conversations, setConversations] = useState<LeadConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const es = language === 'es';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  useEffect(() => {
    let active = true;
    void getLeadConversation(lead.id, lead.dealerId)
      .then(async (response) => {
        if (!response.ok) throw new Error('Conversation request failed');
        return response.json() as Promise<{ conversations: LeadConversation[] }>;
      })
      .then((result) => {
        if (!active) return;
        const items = result.conversations ?? [];
        setConversations(items);
        setSelectedId(items[0]?.id ?? '');
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lead.id, lead.dealerId]);

  const conversation = conversations.find((item) => item.id === selectedId);
  const whatsapp = /whats.?app/i.test(conversation?.channel ?? '');
  const label = (value: string) => /messenger/i.test(value) ? 'Messenger' : /whats.?app/i.test(value) ? 'WhatsApp' : value;
  const formatTime = (value: string | null) => value
    ? new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '';

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="conversation-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--page)] shadow-2xl">
      <header className={`flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 ${whatsapp ? 'bg-[#075e54] text-white' : 'bg-white text-slate-900'}`}>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold ${whatsapp ? 'bg-white/15' : 'bg-[#e8f0fe] text-[#0866ff]'}`}>{lead.name.trim().charAt(0).toUpperCase()}</div>
        <div className="min-w-0 flex-1"><p className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${whatsapp ? 'text-white/70' : 'text-slate-500'}`}>{whatsapp ? 'WhatsApp' : 'Messenger'}</p><h2 id="conversation-title" className="truncate text-base font-semibold">{lead.name}</h2><p className={`text-xs ${whatsapp ? 'text-white/70' : 'text-slate-500'}`}>{lead.phone}</p></div>
        <button type="button" autoFocus onClick={close} aria-label={es ? 'Cerrar conversación' : 'Close conversation'} className={`grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-black/5 ${whatsapp ? 'text-white hover:bg-white/10' : 'text-slate-500'}`}>×</button>
      </header>

      {conversations.length > 1 && <nav aria-label={es ? 'Canales de conversación' : 'Conversation channels'} className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-4 py-3">{conversations.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${selectedId === item.id ? 'bg-[var(--brand)] text-white' : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'}`}>{label(item.channel)}</button>)}</nav>}

      {loading ? <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">{es ? 'Cargando conversación…' : 'Loading conversation…'}</div>
        : error ? <div role="alert" className="grid min-h-72 place-items-center px-6 text-center text-sm text-[var(--error)]">{es ? 'No se pudo cargar la conversación.' : 'Unable to load the conversation.'}</div>
          : !conversation || conversation.messages.length === 0 ? <div className="grid min-h-72 place-items-center px-6 text-center text-sm text-[var(--text-muted)]">{es ? 'No hay mensajes guardados para este contacto.' : 'No saved messages for this contact.'}</div>
            : <div className={`min-h-72 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-7 ${whatsapp ? 'bg-[#efeae2]' : 'bg-[#f6f7f9]'}`}>
              <div className="mx-auto mb-4 w-fit rounded-full bg-white/85 px-3 py-1 text-[10px] text-slate-500 shadow-sm">{conversation.status === 'queued' ? (es ? 'En cola · calificación completa' : 'Queued · qualification complete') : conversation.status}</div>
              {conversation.messages.map((message) => {
                const outgoing = /outbound|outgoing|assistant|bot/i.test(message.direction);
                return <div key={message.id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[86%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm leading-5 shadow-sm sm:max-w-[76%] ${whatsapp ? (outgoing ? 'rounded-2xl rounded-tr-sm bg-[#d9fdd3] text-slate-800' : 'rounded-2xl rounded-tl-sm bg-white text-slate-800') : (outgoing ? 'rounded-[20px] rounded-br-md bg-[#0866ff] text-white' : 'rounded-[20px] rounded-bl-md bg-white text-slate-800')}`}>
                    <p>{message.body || (es ? '[Mensaje sin texto]' : '[Message has no text]')}</p>
                    {message.occurredAt && <time className={`mt-1 block text-right text-[10px] ${outgoing && !whatsapp ? 'text-white/70' : 'text-slate-500'}`}>{formatTime(message.occurredAt)}</time>}
                  </div>
                </div>;
              })}
            </div>}
      <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--text-muted)]"><span>{conversation ? `${conversation.messages.length} ${es ? 'mensajes' : 'messages'}` : ''}</span><span>{conversation?.lastMessageAt ? formatTime(conversation.lastMessageAt) : ''}</span></footer>
    </section>
  </div>;
}
