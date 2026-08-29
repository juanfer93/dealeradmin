'use client';

import { FormEvent, useRef, useState } from 'react';
import { Logo } from '../../components/ui/logo';
import { LanguageSwitch, useLanguage } from '../../lib/i18n';

export default function LoginPage() {
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        throw new Error(t.login.invalid);
      }
      window.location.assign('/app');
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : t.login.unavailable;
      setError(message);
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-[400px] rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-7 shadow-[0_18px_50px_rgba(19,32,29,0.08)] sm:p-9" aria-labelledby="login-title">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-sm font-semibold tracking-[-0.01em]">dealerADMIN</span>
          </div>
          <div className="flex items-center gap-3"><span className="text-xs text-[var(--muted)]">{t.login.console}</span><LanguageSwitch /></div>
        </div>

        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--teal)]">{t.login.eyebrow}</p>
          <h1 id="login-title" className="text-[2rem] font-semibold leading-tight tracking-[-0.035em]">{t.login.title}</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t.login.description}</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="username">{t.login.username}</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-11 w-full rounded-[6px] border border-[var(--line)] bg-transparent px-3.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:ring-2 focus:ring-[color:var(--teal)]/20"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="password">{t.login.password}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-[6px] border border-[var(--line)] bg-transparent px-3.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:ring-2 focus:ring-[color:var(--teal)]/20"
            />
          </div>

          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm leading-5 text-[var(--error)]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-[6px] bg-[var(--teal)] px-4 text-sm font-semibold text-white transition-[background-color,transform,opacity] duration-150 hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-2"
          >
            {loading ? t.login.signingIn : t.login.signIn}
          </button>
        </form>

        <p className="mt-9 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--muted)]">{t.login.restricted}</p>
      </section>
    </main>
  );
}
