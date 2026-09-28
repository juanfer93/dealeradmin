'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { LanguageSwitch, useLanguage } from '../lib/i18n';
import { Logo } from '../components/ui/logo';

type FeatureKey = 'capture' | 'understand' | 'decide' | 'deliver';

const featureImages: Record<FeatureKey, { src: string; alt: string }> = {
  capture: { src: '/captures/manual-lead.png', alt: 'Entrada manual de lead en dealerADMIN' },
  understand: { src: '/captures/reports.png', alt: 'Reportes de leads en dealerADMIN' },
  decide: { src: '/captures/lead-queue.png', alt: 'Cola operativa de leads en dealerADMIN' },
  deliver: { src: '/captures/lead-queue.png', alt: 'Lead listo para entrega en dealerADMIN' },
};

const featureKeys: FeatureKey[] = ['capture', 'understand', 'decide', 'deliver'];

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
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
    }, { threshold: 0.14, rootMargin: '0px 0px -42px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={`landing-reveal ${visible ? 'landing-reveal-visible' : ''} ${className}`} style={{ '--landing-delay': `${delay}ms` } as CSSProperties}>{children}</div>;
}

function ProductFrame({ src, alt, compact = false }: { src: string; alt: string; compact?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[18px] border border-[#17261f]/15 bg-[#17261f] p-2 shadow-[0_24px_70px_rgba(20,48,37,0.16)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_30px_80px_rgba(20,48,37,0.2)] ${compact ? 'max-w-[420px]' : ''}`}>
      <div className="flex items-center gap-1.5 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[#e77b65]" />
        <span className="h-2 w-2 rounded-full bg-[#e3b85c]" />
        <span className="h-2 w-2 rounded-full bg-[#68c58d]" />
        <span className="ml-2 truncate text-[10px] text-[#a9bbb2]">dealerADMIN / cola de leads</span>
      </div>
      <div className="overflow-hidden rounded-[11px] bg-[#f7f9f7]">
        <Image src={src} alt={alt} width={1280} height={900} className="block h-auto w-full" priority={!compact} />
      </div>
    </div>
  );
}

function Arrow() {
  return <span aria-hidden="true" className="text-[#1a8b75]">→</span>;
}

export default function HomePage() {
  const { language, t } = useLanguage();
  const [activeFeature, setActiveFeature] = useState<FeatureKey>('decide');
  const [activeFlow, setActiveFlow] = useState(2);
  const isSpanish = language === 'es';
  const feature = t.landing.capabilities[featureKeys.indexOf(activeFeature)];
  const featureImage = featureImages[activeFeature];
  const flow = isSpanish
    ? [
        ['01', 'Captura', 'Customer Replied inicia la entrada.'],
        ['02', 'Entiende', 'Texto, audio e imagen se convierten en contexto.'],
        ['03', 'Decide', 'El backend normaliza y resuelve el dealer.'],
        ['04', 'Entrega', 'La cola deja la siguiente acción lista.'],
      ]
    : [
        ['01', 'Capture', 'Customer Replied starts the intake.'],
        ['02', 'Understand', 'Text, audio, and images become context.'],
        ['03', 'Decide', 'The backend normalizes and resolves the dealer.'],
        ['04', 'Deliver', 'The queue leaves the next action ready.'],
      ];

  return (
    <main className="landing-page min-h-screen overflow-hidden bg-[#f6f5f0] text-[#17261f]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-3" aria-label="dealerADMIN home">
          <Logo size={34} />
          <span className="text-[15px] font-semibold tracking-[-0.03em]">dealerADMIN</span>
        </Link>
        <nav className="flex items-center gap-3 text-xs text-[#64746d] sm:gap-6" aria-label="Main navigation">
          <a href="#how-it-works" className="hidden transition-colors hover:text-[#17261f] sm:inline">{isSpanish ? 'Cómo funciona' : 'How it works'}</a>
          <a href="#proof" className="hidden transition-colors hover:text-[#17261f] sm:inline">{isSpanish ? 'Qué resuelve' : 'What it solves'}</a>
          <LanguageSwitch />
          <Link href="/login" className="hidden transition-colors hover:text-[#17261f] sm:inline">{t.landing.signIn}</Link>
          <Link href="/app" className="rounded-[8px] bg-[#147d69] px-3.5 py-2.5 font-semibold text-white shadow-[0_7px_18px_rgba(20,125,105,0.18)] transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-[#106b5a]">{t.landing.openConsole}</Link>
        </nav>
      </header>

      <section className="landing-hero mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:px-10 lg:pb-28">
        <div className="landing-hero-copy min-w-0 max-w-xl">
          <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#147d69]">{t.landing.heroEyebrow}</p>
          <h1 className="max-w-[560px] text-[clamp(3rem,4.8vw,5.2rem)] font-semibold leading-[0.96] tracking-[-0.07em] text-balance">{t.landing.heroTitle}</h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-[#64746d]">{t.landing.heroDescription}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/app" className="rounded-[8px] bg-[#147d69] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(20,125,105,0.2)] transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-[#106b5a]">{t.landing.openOperator}</Link>
            <a href="#how-it-works" className="rounded-[8px] border border-[#b9c9c1] bg-transparent px-5 py-3.5 text-sm font-semibold text-[#17261f] transition-colors duration-150 hover:border-[#147d69] hover:text-[#147d69]">{t.landing.seeFlow}</a>
          </div>
          <p className="mt-6 text-xs text-[#829089]">{t.landing.trustLine}</p>
        </div>
        <div className="landing-hero-shot relative min-w-0 lg:pt-5">
          <div className="landing-status-badge absolute -right-8 -top-10 hidden rounded-[12px] border border-[#b9c9c1] bg-white px-4 py-3 text-xs shadow-[0_12px_30px_rgba(20,48,37,0.08)] sm:block">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#36aa77]" />
            {isSpanish ? 'Cola lista para actuar' : 'Queue ready for action'}
          </div>
          <ProductFrame src="/captures/lead-queue.png" alt="Cola operativa de leads de dealerADMIN" />
          <div className="mt-3 flex items-center justify-between px-1 text-xs text-[#829089]"><span>{isSpanish ? 'Vista real del producto' : 'Real product view'}</span><span className="font-semibold text-[#147d69]">{isSpanish ? 'Handoff humano' : 'Human handoff'} <Arrow /></span></div>
        </div>
      </section>

      <section id="proof" className="border-y border-[#d9dfda] bg-white/65">
        <Reveal className="mx-auto max-w-7xl">
        <div className="grid gap-px bg-[#d9dfda] sm:grid-cols-3">
          {(isSpanish ? [
            ['Una entrada', 'Customer Replied activa el workflow y firma el evento.'],
            ['Un registro', 'Cada mensaje queda vinculado a su conversación.'],
            ['Una acción', 'El operador recibe contexto listo para entregar.'],
          ] : [
            ['One intake', 'Customer Replied activates the workflow and signs the event.'],
            ['One record', 'Every message stays linked to its conversation.'],
            ['One action', 'The operator receives context ready for handoff.'],
          ]).map(([title, detail]) => (
            <div key={title} className="bg-[#f6f5f0] px-5 py-7 sm:px-8 lg:px-10">
              <p className="text-sm font-semibold text-[#17261f]">{title}</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-[#718078]">{detail}</p>
            </div>
          ))}
        </div>
        </Reveal>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
        <Reveal>
        <div className="grid gap-12 lg:grid-cols-[0.6fr_1.4fr] lg:gap-20">
          <div className="max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#147d69]">{isSpanish ? 'Una operación, cuatro momentos' : 'One operation, four moments'}</p>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.02] tracking-[-0.06em] text-balance sm:text-5xl">{isSpanish ? 'La conversación termina en una siguiente acción.' : 'The conversation ends with a next action.'}</h2>
            <p className="mt-5 text-sm leading-6 text-[#64746d]">{t.landing.capabilitiesDescription}</p>
            <div className="mt-9 flex flex-wrap gap-2">
              {featureKeys.map((key, index) => {
                const item = t.landing.capabilities[index];
                return <button key={key} type="button" aria-pressed={activeFeature === key} onClick={() => setActiveFeature(key)} className={`rounded-full border px-3 py-2 text-xs font-semibold transition-[background-color,border-color,color] duration-150 ${activeFeature === key ? 'border-[#147d69] bg-[#147d69] text-white' : 'border-[#cbd6d0] bg-transparent text-[#64746d] hover:border-[#147d69] hover:text-[#147d69]'}`}>{item[0]}</button>;
              })}
            </div>
          </div>
          <div className="grid items-center gap-8 rounded-[18px] border border-[#d6ded8] bg-white p-4 shadow-[0_18px_50px_rgba(20,48,37,0.07)] sm:p-6 lg:grid-cols-[1.05fr_0.95fr] lg:p-7">
            <div key={activeFeature} className="landing-feature-image"><ProductFrame src={featureImage.src} alt={featureImage.alt} compact /></div>
            <div className="max-w-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#147d69]">{feature[3]}</p>
              <h3 className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.04em]">{feature[1]}</h3>
              <p className="mt-4 text-sm leading-6 text-[#64746d]">{feature[2]}</p>
              <p className="mt-7 text-sm font-semibold text-[#147d69]">{isSpanish ? 'Ver evidencia en la consola' : 'See the evidence in the console'} <Arrow /></p>
            </div>
          </div>
        </div>
        </Reveal>
      </section>

      <section className="bg-[#17261f] text-[#f4f7f4]">
        <Reveal>
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-28">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6bd1ae]">{isSpanish ? 'Del webhook al handoff' : 'From webhook to handoff'}</p>
              <h2 className="mt-5 text-4xl font-semibold leading-[1.02] tracking-[-0.06em] text-balance sm:text-5xl">{isSpanish ? 'Cada paso tiene un lugar y una evidencia.' : 'Every step has a place and evidence.'}</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-[#b6c5bd]">{t.landing.workflowDescription}</p>
          </div>
          <div className="landing-flow mt-14 grid gap-3 md:grid-cols-4">
            {flow.map(([number, title, detail], index) => <button key={number} type="button" onClick={() => setActiveFlow(index)} aria-pressed={activeFlow === index} className={`group rounded-[14px] border p-5 text-left transition-[background-color,border-color,transform] duration-200 ${activeFlow === index ? 'translate-y-[-3px] border-[#6bd1ae] bg-[#21493b]' : 'border-white/10 bg-[#1c332a] hover:-translate-y-px hover:border-white/25'}`}><span className="text-xs font-semibold tracking-[0.16em] text-[#6bd1ae]">{number}</span><span className="mt-8 block text-lg font-semibold tracking-[-0.03em]">{title}</span><span className="mt-3 block text-sm leading-6 text-[#b6c5bd]">{detail}</span></button>)}
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-5 text-sm text-[#b6c5bd]" aria-live="polite"><span className="h-2 w-2 rounded-full bg-[#6bd1ae]" />{flow[activeFlow][1]} <Arrow /></div>
        </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
        <Reveal>
        <div className="grid items-center gap-10 rounded-[18px] border border-[#cbd6d0] bg-[#e9f0eb] p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:p-12">
          <div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#147d69]">{t.landing.privateEyebrow}</p><h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.05em] sm:text-4xl">{t.landing.privateTitle}</h2><p className="mt-4 text-sm leading-6 text-[#64746d]">{t.landing.privateDescription}</p></div>
          <Link href="/app" className="inline-flex w-fit rounded-[8px] bg-[#17261f] px-5 py-3.5 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-[#263f34]">{t.landing.openOperator}</Link>
        </div>
        </Reveal>
      </section>

      <footer className="border-t border-[#d9dfda] px-5 py-7 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-[#829089] sm:flex-row sm:items-center sm:justify-between"><span>{t.landing.footerLeft}</span><span>{t.landing.footerRight}</span></div></footer>
      <style jsx>{`
        @keyframes landing-fade-up {
          from { opacity: 0; transform: translate3d(0, 24px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes landing-feature-in {
          from { opacity: 0; transform: translate3d(0, 24px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        .landing-hero-copy { animation: landing-fade-up 560ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-hero-shot { animation: landing-fade-up 700ms 90ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-flow > button { animation: landing-fade-up 480ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-flow > button:nth-child(2) { animation-delay: 60ms; }
        .landing-flow > button:nth-child(3) { animation-delay: 120ms; }
        .landing-flow > button:nth-child(4) { animation-delay: 180ms; }
        .landing-feature-image { animation: landing-feature-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .landing-reveal { opacity: 0; transform: translate3d(0, 24px, 0); transition: none; }
        .landing-reveal-visible { animation: landing-fade-up 560ms cubic-bezier(0.22, 1, 0.36, 1) var(--landing-delay, 0ms) both; }
        .landing-status-badge { animation: landing-fade-up 520ms 340ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .landing-hero-copy, .landing-hero-shot, .landing-flow > button, .landing-feature-image, .landing-status-badge, .landing-reveal-visible { animation: none; }
          .landing-reveal, .landing-reveal-visible { opacity: 1; transform: none; transition: none; }
        }
      `}</style>
    </main>
  );
}
