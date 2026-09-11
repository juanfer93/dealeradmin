'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { Logo } from '../components/ui/logo';
import { LanguageSwitch, useLanguage } from '../lib/i18n';

type FlowStage = 'collector' | 'ghl' | 'api' | 'queue';

function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={`landing-reveal ${visible ? 'landing-reveal-visible' : ''} ${className}`} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>{children}</div>;
}

function FlowDiagram() {
  const { language } = useLanguage();
  const [activeStage, setActiveStage] = useState<FlowStage>('collector');
  const flow = language === 'es'
    ? { collector: ['01 · Mensaje', 'Workflow de Customer Replied', 'Activa la captura, normaliza el teléfono cuando hace falta y envía el evento firmado.', 'Mensaje listo'], ghl: ['02 · Webhook', 'Endpoint de la fuente GHL', 'Entrega Contact ID, conversación, contenido, nombre, teléfono y canal.', 'Evento recibido'], api: ['03 · Backend', 'API de dealerADMIN', 'Guarda, deduplica, reconstruye, normaliza y enruta la conversación.', 'Procesado + auditable'], queue: ['04 · DealerADMIN', 'Cola operativa', 'La hora de Colombia, la ventana y el routing deciden cuándo aparece el lead.', 'Acción del operador pendiente'] }
    : { collector: ['01 · Message', 'Customer Replied workflow', 'Activates capture, normalizes the phone when needed, and sends the signed event.', 'Message ready'], ghl: ['02 · Webhook', 'GHL source endpoint', 'Delivers Contact ID, conversation, content, name, phone, and channel.', 'Event received'], api: ['03 · Backend', 'dealerADMIN API', 'Stores, deduplicates, rebuilds, normalizes, and routes the conversation.', 'Processed + auditable'], queue: ['04 · dealerADMIN', 'Operator queue', 'Colombia time, the timing window, and routing decide when the lead appears.', 'Operator action pending'] };
  const active = flow[activeStage];

  return (
    <div className="landing-flow rounded-[10px] border border-white/10 bg-[#17231D]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-4 text-xs"><span className="font-semibold text-[#F1F7F4]">{language === 'es' ? 'Modelo de entrega en vivo' : 'Live handoff model'}</span><span className="inline-flex items-center gap-2 text-[#AFC1B9]"><span className="h-2 w-2 rounded-full bg-[#5ED5AA]" />{language === 'es' ? 'Ruta de evento firmada' : 'Signed event path'}</span></div>
      <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-2">
        <div className="pointer-events-none absolute left-[12%] right-[12%] top-[74px] hidden h-px bg-[#5ED5AA]/30 lg:block" aria-hidden="true" />
        {(['collector', 'ghl', 'api', 'queue'] as FlowStage[]).map((stage) => {
          const item = flow[stage];
          const isActive = activeStage === stage;
          return <button key={stage} type="button" onClick={() => setActiveStage(stage)} aria-pressed={isActive} className={`relative z-10 min-h-[158px] rounded-[12px] border p-4 text-left transition-[background-color,border-color,transform,box-shadow] duration-200 ${isActive ? 'border-[#5ED5AA]/70 bg-[#193A30] -translate-y-0.5 shadow-[0_12px_30px_rgba(0,0,0,0.16)]' : 'border-white/10 bg-[#111815] hover:-translate-y-px hover:border-white/25'}`}><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{item[0]}</span><span className="mt-3 block text-sm font-semibold leading-5 text-[#F1F7F4]">{item[1]}</span><span className="mt-2 block text-xs leading-5 text-[#AFC1B9]">{item[3]}</span></button>;
        })}
      </div>
      <div className="mt-4 rounded-[10px] border border-white/10 bg-[#111815] px-4 py-3" aria-live="polite"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{active[0]}</p><p className="mt-1 text-sm text-[#F1F7F4]">{active[2]}</p></div>
    </div>
  );
}

function BackendWorkflowDiagram() {
  const { language } = useLanguage();
  const workflows = language === 'es'
    ? [['Un workflow', 'Customer Replied', 'Activación de la fuente GHL', 'Cada respuesta entra por el workflow del dealer. Normaliza el teléfono cuando hace falta y envía el evento al endpoint específico.']]
    : [['One workflow', 'Customer Replied', 'GHL source activation', 'Every reply enters through the dealer workflow. It normalizes the phone when needed and sends the event to the source endpoint.']];
  const backendSteps = language === 'es'
    ? [['01', 'Guardar', 'Cada mensaje queda en webhook_events y conversation_messages con deduplicación.'], ['02', 'Normalizar', 'El backend reconstruye la conversación y actualiza su snapshot.'], ['03', 'Resolver', 'Aplica idioma, alternancia de dealers y routing geográfico cuando corresponde.'], ['04', 'Esperar', 'La ventana usa hora de Colombia: 30 min de 03:00 a 15:00 o 3 h fuera de esa ventana.'], ['05', 'Mostrar', 'DealerADMIN publica el lead cuando cumple el mínimo operativo.']]
    : [['01', 'Store', 'Every message is stored in webhook_events and conversation_messages with deduplication.'], ['02', 'Normalize', 'The backend rebuilds the conversation and updates its snapshot.'], ['03', 'Resolve', 'It applies language, dealer alternation, and geographic routing where needed.'], ['04', 'Wait', 'The window uses Colombia time: 30m from 03:00 to 15:00 or 3h outside that window.'], ['05', 'Show', 'DealerADMIN publishes the lead when it meets the operating minimum.']];

  return <div className="landing-flow rounded-[10px] border border-white/10 bg-[#17231D]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6">
    <div className="mb-6 flex items-center justify-between gap-4 text-xs"><span className="font-semibold text-[#F1F7F4]">{language === 'es' ? 'Un workflow por fuente en GHL' : 'One workflow per GHL source'}</span><span className="inline-flex items-center gap-2 text-[#AFC1B9]"><span className="h-2 w-2 rounded-full bg-[#5ED5AA]" />{language === 'es' ? 'El backend conserva la lógica' : 'The backend owns the logic'}</span></div>
    <div className="grid gap-3 md:grid-cols-2">
      {workflows.map(([eyebrow, title, trigger, detail], index) => <article key={title} className={`min-h-[170px] rounded-[12px] border p-5 ${index === 1 ? 'border-[#5ED5AA]/70 bg-[#193A30]' : 'border-white/10 bg-[#111815]'}`}><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{eyebrow}</span><h3 className="mt-3 text-sm font-semibold text-[#F1F7F4]">{title}</h3><p className="mt-2 text-xs font-medium text-[#D8EEE5]">{trigger}</p><p className="mt-2 text-xs leading-5 text-[#AFC1B9]">{detail}</p></article>)}
    </div>
    <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]"><span className="h-px flex-1 bg-[#5ED5AA]/30" />{language === 'es' ? 'Después de GHL' : 'After GHL'}<span className="h-px flex-1 bg-[#5ED5AA]/30" /></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {backendSteps.map(([number, title, detail]) => <article key={number} className="min-h-[142px] border-l-2 border-[#5ED5AA]/35 bg-[#111815] p-4"><span className="text-xs font-semibold tracking-[0.12em] text-[#5ED5AA]">{number}</span><h3 className="mt-3 text-sm font-semibold text-[#F1F7F4]">{title}</h3><p className="mt-2 text-xs leading-5 text-[#AFC1B9]">{detail}</p></article>)}
    </div>
  </div>;
}

export default function HomePage() {
  const { language, t } = useLanguage();
  const workflowCopy = language === 'es'
    ? { eyebrow: 'Workflow de mensajes en GHL', title: 'Un workflow captura; dealerADMIN hace el resto.', description: 'Customer Replied activa un único workflow por fuente. Ese workflow normaliza el teléfono cuando hace falta y envía cada mensaje al webhook específico; la memoria, la cualificación, el routing y la cola viven en dealerADMIN.', steps: [['01', 'Activar', 'Customer Replied inicia el workflow'], ['02', 'Normalizar', 'Custom code prepara Contact.Phone cuando hace falta'], ['03', 'Enviar', 'El webhook manda Contact ID, conversación, mensaje, nombre, teléfono y canal'], ['04', 'Guardar', 'La BD persiste el evento y reconstruye la conversación'], ['05', 'Resolver', 'El backend normaliza, enruta y calcula la ventana'], ['06', 'Mostrar', 'La cola aparece cuando cumple el mínimo operativo']] as Array<[string, string, string]> }
    : { eyebrow: 'GHL message workflow', title: 'One workflow captures; dealerADMIN does the rest.', description: 'Customer Replied activates one workflow per source. It normalizes the phone when needed and sends every message to the source endpoint; memory, qualification, routing, and the queue live in dealerADMIN.', steps: [['01', 'Activate', 'Customer Replied starts the workflow'], ['02', 'Normalize', 'Custom code prepares Contact.Phone when needed'], ['03', 'Send', 'The webhook sends Contact ID, conversation, message, name, phone, and channel'], ['04', 'Store', 'The database persists the event and rebuilds the conversation'], ['05', 'Resolve', 'The backend normalizes, routes, and calculates the window'], ['06', 'Show', 'The queue appears when it meets the operating minimum']] as Array<[string, string, string]> };

  return (
    <main className="min-h-screen overflow-hidden bg-[#111815] text-[#F1F7F4]">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-white/10 px-5 py-4 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-3" aria-label="dealerADMIN home"><Logo size={34} /><span className="text-[15px] font-semibold tracking-[-0.02em]">dealerADMIN</span></Link>
        <nav className="flex items-center gap-3 text-xs text-[#AFC1B9] sm:gap-7" aria-label={t.landing.howItWorks}>
          <a href="#flow" className="hidden transition-colors hover:text-[#F1F7F4] sm:inline">{t.landing.howItWorks}</a>
          <a href="#case-study" className="hidden transition-colors hover:text-[#F1F7F4] sm:inline">{t.landing.caseStudy}</a>
          <LanguageSwitch dark />
          <Link href="/login" className="transition-colors hover:text-[#F1F7F4]">{t.landing.signIn}</Link>
          <Link href="/app" className="rounded-[6px] bg-[#5ED5AA] px-3.5 py-2.5 font-semibold text-[#0B0F0D] transition-colors hover:bg-[#7AE1BF]">{t.landing.openConsole}</Link>
        </nav>
      </header>

      <section className="landing-grid relative mx-auto max-w-7xl px-5 pb-20 pt-20 sm:px-8 sm:pb-24 sm:pt-28 lg:px-10 lg:pb-28">
        <div className="relative z-10 max-w-5xl">
          <p className="landing-rise landing-rise-1 mb-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.heroEyebrow}</p>
          <h1 className="landing-rise landing-rise-2 max-w-[920px] text-[clamp(3.25rem,7.2vw,6.5rem)] font-semibold leading-[0.94] tracking-[-0.075em]">{t.landing.heroTitle}</h1>
          <div className="landing-rise landing-rise-3"><p className="mt-7 max-w-2xl text-base leading-7 text-[#AFC1B9]">{t.landing.heroDescription}</p><div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/app" className="rounded-[7px] bg-[#5ED5AA] px-5 py-3.5 text-sm font-semibold text-[#0B0F0D] transition-[background-color,transform] duration-150 hover:bg-[#7AE1BF] active:scale-[0.98]">{t.landing.openOperator}</Link><a href="#flow" className="rounded-[7px] border border-white/15 px-5 py-3.5 text-sm font-semibold text-[#F1F7F4] transition-colors hover:border-white/35">{t.landing.seeFlow}</a></div><p className="mt-6 text-xs text-[#7F948A]">{t.landing.trustLine}</p></div>
        </div>
        <div id="flow" className="landing-rise landing-rise-2 relative z-10 mt-12 scroll-mt-8 sm:mt-14"><FlowDiagram /></div>
      </section>

      <section className="landing-rise landing-rise-section-1 border-y border-white/10 bg-[#0D1310]" aria-label={t.landing.principlesLabel}><div className="mx-auto grid max-w-7xl gap-px bg-white/10 sm:grid-cols-3">{t.landing.principles.map(([title, detail], index) => <Reveal key={title} delay={index * 70}><div className="h-full bg-[#0D1310] px-5 py-8 sm:px-8 lg:px-10"><h2 className="text-sm font-semibold text-[#F1F7F4]">{title}</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[#7F948A]">{detail}</p></div></Reveal>)}</div></section>

      <section className="landing-rise landing-rise-section-2 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32" aria-labelledby="captures-title"><Reveal><div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.capturesEyebrow}</p><h2 id="captures-title" className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{t.landing.capturesTitle}</h2><p className="mt-4 text-sm leading-6 text-[#AFC1B9]">{t.landing.capturesDescription}</p></div></Reveal><div className="mt-12 grid gap-5 lg:grid-cols-12">{t.landing.captures.slice(0, 1).map(([title, detail, src, alt]) => { const isManualCapture = src.includes('manual-lead'); return <Reveal key={title} delay={0} className="lg:col-span-7"><article className="h-full overflow-hidden rounded-[10px] border border-white/10 bg-[#17231D] transition-transform duration-300 hover:-translate-y-1"><div className={`overflow-hidden border-b border-white/10 bg-[#0D1310] p-2 ${isManualCapture ? 'flex h-[420px] items-center justify-center bg-[#6f7372]' : ''}`}><Image src={src} alt={alt} width={1280} height={900} className={isManualCapture ? 'h-full w-auto max-w-full object-contain' : 'h-auto w-full rounded-[6px]'} loading="lazy" /></div><div className="p-5"><h3 className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></div></article></Reveal>; })}<div className="grid gap-5 lg:col-span-5">{t.landing.captures.slice(1).map(([title, detail, src, alt], index) => { const isManualCapture = src.includes('manual-lead'); return <Reveal key={title} delay={(index + 1) * 90}><article className="h-full overflow-hidden rounded-[10px] border border-white/10 bg-[#17231D] transition-transform duration-300 hover:-translate-y-1"><div className={`overflow-hidden border-b border-white/10 bg-[#0D1310] p-2 ${isManualCapture ? 'flex h-[420px] items-center justify-center bg-[#6f7372]' : ''}`}><Image src={src} alt={alt} width={1280} height={900} className={isManualCapture ? 'h-full w-auto max-w-full object-contain' : 'h-auto w-full rounded-[6px]'} loading="lazy" /></div><div className="p-5"><h3 className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></div></article></Reveal>; })}</div></div></section>

      <section className="landing-rise landing-rise-section-2 border-y border-white/10 bg-[#0D1310]" aria-labelledby="workflow-title"><div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10"><Reveal><div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{workflowCopy.eyebrow}</p><h2 id="workflow-title" className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{workflowCopy.title}</h2><p className="mt-4 text-sm leading-6 text-[#AFC1B9]">{workflowCopy.description}</p></div></Reveal><Reveal delay={80} className="mt-10"><BackendWorkflowDiagram /></Reveal><div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{workflowCopy.steps.map(([number, title, detail], index) => <Reveal key={number} delay={index * 75}><article className="h-full border-l-2 border-[#5ED5AA]/35 bg-[#111815] p-5"><span className="text-xs font-semibold tracking-[0.12em] text-[#5ED5AA]">{number}</span><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></article></Reveal>)}</div></div></section>

      <section id="case-study" className="landing-rise landing-rise-section-2 mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-10 lg:py-32"><Reveal><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.caseEyebrow}</p><h2 className="mt-5 max-w-sm text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{t.landing.caseTitle}</h2></div></Reveal><div className="grid gap-10 border-l border-white/10 pl-6 sm:grid-cols-2 sm:gap-x-12 sm:pl-10">{t.landing.caseArticles.map(([title, detail], index) => <Reveal key={title} delay={index * 75}><article><span className="text-3xl font-semibold tracking-[-0.04em] text-[#5ED5AA]">{String(index + 1).padStart(2, '0')}</span><h3 className="mt-4 text-base font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[#AFC1B9]">{detail}</p></article></Reveal>)}</div></section>

      <section className="landing-rise landing-rise-section-2 border-y border-white/10 bg-[#0D1310]" aria-labelledby="stacks-title"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-10"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.stacksEyebrow}</p><h2 id="stacks-title" className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t.landing.stacksTitle}</h2></div><div><p className="max-w-xl text-sm leading-6 text-[#AFC1B9]">{t.landing.stacksDescription}</p><div className="mt-6 flex max-w-2xl flex-wrap gap-2">{t.landing.stacks.map((stack) => <span key={stack} className="rounded-[4px] border border-[#5ED5AA]/25 bg-[#16382E] px-3 py-2 text-xs font-semibold text-[#D8EEE5]">{stack}</span>)}</div></div></div></section>

      <section className="landing-rise landing-rise-section-3 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32"><div className="flex flex-col justify-between gap-8 rounded-[8px] border border-[#5ED5AA]/25 bg-[#16382E] px-6 py-10 sm:px-10 lg:flex-row lg:items-end"><div className="max-w-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.privateEyebrow}</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t.landing.privateTitle}</h2><p className="mt-4 text-sm leading-6 text-[#C1D8CD]">{t.landing.privateDescription}</p></div><Link href="/app" className="inline-flex w-fit shrink-0 rounded-[7px] bg-[#F1F7F4] px-5 py-3.5 text-sm font-semibold text-[#111815] transition-colors hover:bg-white">{t.landing.openOperator}</Link></div></section>

      <footer className="border-t border-white/10 px-5 py-7 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-[#7F948A] sm:flex-row sm:items-center sm:justify-between"><span>{t.landing.footerLeft}</span><span>{t.landing.footerRight}</span></div></footer>
    </main>
  );
}
