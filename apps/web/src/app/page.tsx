'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { Logo } from '../components/ui/logo';
import { LanguageSwitch, useLanguage } from '../lib/i18n';

type FlowStage = 'ghl' | 'api' | 'queue';

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
  const { t } = useLanguage();
  const [activeStage, setActiveStage] = useState<FlowStage>('api');
  const active = t.landing.flow[activeStage];

  return (
    <div className="landing-flow rounded-[10px] border border-white/10 bg-[#17231D]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-4 text-xs">
        <span className="font-semibold text-[#F1F7F4]">{t.landing.liveModel}</span>
        <span className="inline-flex items-center gap-2 text-[#AFC1B9]"><span className="h-2 w-2 rounded-full bg-[#5ED5AA]" />{t.landing.signedPath}</span>
      </div>
      <div className="relative grid gap-3 sm:grid-cols-3 sm:gap-2">
        <div className="pointer-events-none absolute left-[16%] right-[16%] top-[52px] hidden h-px bg-[#5ED5AA]/35 sm:block" aria-hidden="true" />
        {(['ghl', 'api', 'queue'] as FlowStage[]).map((stage) => {
          const item = t.landing.flow[stage];
          const isActive = activeStage === stage;
          return <button key={stage} type="button" onClick={() => setActiveStage(stage)} aria-pressed={isActive} className={`relative z-10 min-h-[126px] rounded-[12px] border p-4 text-left transition-[background-color,border-color,transform] duration-200 ${isActive ? 'border-[#5ED5AA]/70 bg-[#193A30] -translate-y-0.5' : 'border-white/10 bg-[#111815] hover:border-white/25'}`}><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{item[0]}</span><span className="mt-3 block text-sm font-semibold text-[#F1F7F4]">{item[1]}</span><span className="mt-2 block text-xs leading-5 text-[#AFC1B9]">{item[3]}</span></button>;
        })}
      </div>
      <div className="mt-4 rounded-[10px] border border-white/10 bg-[#111815] px-4 py-3" aria-live="polite"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{active[0]}</p><p className="mt-1 text-sm text-[#F1F7F4]">{active[2]}</p></div>
    </div>
  );
}

function CollectorWorkflowDiagram() {
  const { language } = useLanguage();
  const steps = language === 'es'
    ? [['01', 'Entrada', 'Cliente responde o cambia un campo'], ['02', 'Extracción', 'Reglas rápidas + AI cuando hace falta'], ['03', 'Memoria', 'Consolida datos válidos sin duplicados'], ['04', 'Decisión', 'Completo, parcial o sin teléfono'], ['05', 'Listo para disparar', 'Deja el contacto preparado para el webhook']]
    : [['01', 'Intake', 'Customer replies or changes a field'], ['02', 'Extraction', 'Fast rules + AI when needed'], ['03', 'Memory', 'Consolidates valid data without duplicates'], ['04', 'Decision', 'Complete, partial, or no phone'], ['05', 'Ready to trigger', 'Leaves the contact ready for the webhook']];

  return <div className="landing-flow rounded-[10px] border border-white/10 bg-[#17231D]/95 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6"><div className="mb-6 flex items-center justify-between gap-4 text-xs"><span className="font-semibold text-[#F1F7F4]">{language === 'es' ? 'Workflow recolector' : 'Collector workflow'}</span><span className="inline-flex items-center gap-2 text-[#AFC1B9]"><span className="h-2 w-2 rounded-full bg-[#5ED5AA]" />{language === 'es' ? 'Antes del disparador' : 'Before the trigger'}</span></div><div className="relative grid gap-3 sm:grid-cols-5 sm:gap-2"><div className="pointer-events-none absolute left-[8%] right-[8%] top-[52px] hidden h-px bg-[#5ED5AA]/35 sm:block" aria-hidden="true" />{steps.map(([number, title, detail]) => <div key={number} className="relative z-10 min-h-[126px] rounded-[12px] border border-white/10 bg-[#111815] p-4"><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5ED5AA]">{number}</span><span className="mt-3 block text-sm font-semibold text-[#F1F7F4]">{title}</span><span className="mt-2 block text-xs leading-5 text-[#AFC1B9]">{detail}</span></div>)}</div></div>;
}

export default function HomePage() {
  const { language, t } = useLanguage();

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

      <section className="landing-grid relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-24 pt-24 sm:px-8 sm:pt-32 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-10 lg:pb-36">
        <div className="relative z-10 max-w-xl">
          <p className="landing-rise landing-rise-1 mb-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.heroEyebrow}</p>
          <h1 className="landing-rise landing-rise-2 max-w-[620px] text-[clamp(2.75rem,5.5vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.065em]">{t.landing.heroTitle}</h1>
          <div className="landing-rise landing-rise-3"><p className="mt-7 max-w-md text-base leading-7 text-[#AFC1B9]">{t.landing.heroDescription}</p><div className="mt-9 flex flex-wrap items-center gap-3"><Link href="/app" className="rounded-[7px] bg-[#5ED5AA] px-5 py-3.5 text-sm font-semibold text-[#0B0F0D] transition-[background-color,transform] duration-150 hover:bg-[#7AE1BF] active:scale-[0.98]">{t.landing.openOperator}</Link><a href="#flow" className="rounded-[7px] border border-white/15 px-5 py-3.5 text-sm font-semibold text-[#F1F7F4] transition-colors hover:border-white/35">{t.landing.seeFlow}</a></div><p className="mt-6 text-xs text-[#7F948A]">{t.landing.trustLine}</p></div>
        </div>
        <div id="flow" className="landing-rise landing-rise-2 relative z-10 scroll-mt-8"><FlowDiagram /></div>
      </section>

      <section className="landing-rise landing-rise-section-1 border-y border-white/10 bg-[#0D1310]" aria-label={t.landing.principlesLabel}><div className="mx-auto grid max-w-7xl gap-px bg-white/10 sm:grid-cols-3">{t.landing.principles.map(([title, detail], index) => <Reveal key={title} delay={index * 70}><div className="h-full bg-[#0D1310] px-5 py-8 sm:px-8 lg:px-10"><h2 className="text-sm font-semibold text-[#F1F7F4]">{title}</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[#7F948A]">{detail}</p></div></Reveal>)}</div></section>

      <section className="landing-rise landing-rise-section-2 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32" aria-labelledby="captures-title"><Reveal><div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.capturesEyebrow}</p><h2 id="captures-title" className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{t.landing.capturesTitle}</h2><p className="mt-4 text-sm leading-6 text-[#AFC1B9]">{t.landing.capturesDescription}</p></div></Reveal><div className="mt-12 grid gap-5 lg:grid-cols-12">{t.landing.captures.slice(0, 1).map(([title, detail, src, alt]) => { const isManualCapture = src.includes('manual-lead'); return <Reveal key={title} delay={0} className="lg:col-span-7"><article className="h-full overflow-hidden rounded-[10px] border border-white/10 bg-[#17231D] transition-transform duration-300 hover:-translate-y-1"><div className={`overflow-hidden border-b border-white/10 bg-[#0D1310] p-2 ${isManualCapture ? 'flex h-[420px] items-center justify-center bg-[#6f7372]' : ''}`}><Image src={src} alt={alt} width={1280} height={900} className={isManualCapture ? 'h-full w-auto max-w-full object-contain' : 'h-auto w-full rounded-[6px]'} loading="lazy" /></div><div className="p-5"><h3 className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></div></article></Reveal>; })}<div className="grid gap-5 lg:col-span-5">{t.landing.captures.slice(1).map(([title, detail, src, alt], index) => { const isManualCapture = src.includes('manual-lead'); return <Reveal key={title} delay={(index + 1) * 90}><article className="h-full overflow-hidden rounded-[10px] border border-white/10 bg-[#17231D] transition-transform duration-300 hover:-translate-y-1"><div className={`overflow-hidden border-b border-white/10 bg-[#0D1310] p-2 ${isManualCapture ? 'flex h-[420px] items-center justify-center bg-[#6f7372]' : ''}`}><Image src={src} alt={alt} width={1280} height={900} className={isManualCapture ? 'h-full w-auto max-w-full object-contain' : 'h-auto w-full rounded-[6px]'} loading="lazy" /></div><div className="p-5"><h3 className="text-base font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></div></article></Reveal>; })}</div></div></section>

      <section className="landing-rise landing-rise-section-2 border-y border-white/10 bg-[#0D1310]" aria-labelledby="workflow-title"><div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10"><Reveal><div className="max-w-2xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.workflowEyebrow}</p><h2 id="workflow-title" className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{t.landing.workflowTitle}</h2><p className="mt-4 text-sm leading-6 text-[#AFC1B9]">{t.landing.workflowDescription}</p></div></Reveal><Reveal delay={80} className="mt-10"><CollectorWorkflowDiagram /></Reveal><Reveal delay={120} className="mt-10 overflow-hidden rounded-[10px] border border-white/10 bg-[#111815] p-2 sm:p-3"><div className="flex items-center gap-2 border-b border-white/10 px-3 py-3"><span className="h-2 w-2 rounded-full bg-[#5ED5AA]" /><p className="text-xs font-semibold text-[#F1F7F4]">{language === 'es' ? 'Captura documentada del builder de GHL' : 'Documented GHL builder capture'}</p></div><Image src="/captures/ghl-workflow.svg" alt={language === 'es' ? 'Vista documentada del workflow de GHL con disparadores, condiciones, webhook y ramas alternativas' : 'Documented GHL workflow view with triggers, conditions, webhook, and alternative branches'} width={1440} height={760} className="mt-2 h-auto w-full rounded-[6px]" loading="lazy" /></Reveal><div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{t.landing.workflowSteps.map(([number, title, detail], index) => <Reveal key={number} delay={index * 75}><article className="h-full border-l-2 border-[#5ED5AA]/35 bg-[#111815] p-5"><span className="text-xs font-semibold tracking-[0.12em] text-[#5ED5AA]">{number}</span><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#AFC1B9]">{detail}</p></article></Reveal>)}</div></div></section>

      <section id="case-study" className="landing-rise landing-rise-section-2 mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-10 lg:py-32"><Reveal><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.caseEyebrow}</p><h2 className="mt-5 max-w-sm text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{t.landing.caseTitle}</h2></div></Reveal><div className="grid gap-10 border-l border-white/10 pl-6 sm:grid-cols-2 sm:gap-x-12 sm:pl-10">{t.landing.caseArticles.map(([title, detail], index) => <Reveal key={title} delay={index * 75}><article><span className="text-3xl font-semibold tracking-[-0.04em] text-[#5ED5AA]">{String(index + 1).padStart(2, '0')}</span><h3 className="mt-4 text-base font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[#AFC1B9]">{detail}</p></article></Reveal>)}</div></section>

      <section className="landing-rise landing-rise-section-2 border-y border-white/10 bg-[#0D1310]" aria-labelledby="stacks-title"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-10"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.stacksEyebrow}</p><h2 id="stacks-title" className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t.landing.stacksTitle}</h2></div><div><p className="max-w-xl text-sm leading-6 text-[#AFC1B9]">{t.landing.stacksDescription}</p><div className="mt-6 flex max-w-2xl flex-wrap gap-2">{t.landing.stacks.map((stack) => <span key={stack} className="rounded-[4px] border border-[#5ED5AA]/25 bg-[#16382E] px-3 py-2 text-xs font-semibold text-[#D8EEE5]">{stack}</span>)}</div></div></div></section>

      <section className="landing-rise landing-rise-section-3 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32"><div className="flex flex-col justify-between gap-8 rounded-[8px] border border-[#5ED5AA]/25 bg-[#16382E] px-6 py-10 sm:px-10 lg:flex-row lg:items-end"><div className="max-w-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5ED5AA]">{t.landing.privateEyebrow}</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t.landing.privateTitle}</h2><p className="mt-4 text-sm leading-6 text-[#C1D8CD]">{t.landing.privateDescription}</p></div><Link href="/app" className="inline-flex w-fit shrink-0 rounded-[7px] bg-[#F1F7F4] px-5 py-3.5 text-sm font-semibold text-[#111815] transition-colors hover:bg-white">{t.landing.openOperator}</Link></div></section>

      <footer className="border-t border-white/10 px-5 py-7 sm:px-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-[#7F948A] sm:flex-row sm:items-center sm:justify-between"><span>{t.landing.footerLeft}</span><span>{t.landing.footerRight}</span></div></footer>
    </main>
  );
}
