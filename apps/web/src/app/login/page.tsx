'use client';

import { FormEvent, useRef, useState } from 'react';

export default function LoginPage() {
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
        throw new Error('The username or password does not match.');
      }
      window.location.assign('/dashboard');
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : 'Unable to sign in right now.';
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
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--teal)] text-sm font-bold text-white" aria-hidden="true">d</span>
            <span className="text-sm font-semibold tracking-[-0.01em]">dealerADMIN</span>
          </div>
          <span className="text-xs text-[var(--muted)]">Operator console</span>
        </div>

        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--teal)]">Secure access</p>
          <h1 id="login-title" className="text-[2rem] font-semibold leading-tight tracking-[-0.035em]">Welcome back</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Sign in to manage lead routing and operator tasks.</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="username">Username</label>
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
            <label className="mb-2 block text-sm font-medium" htmlFor="password">Password</label>
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-9 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--muted)]">Access is restricted to authorized operators. Session cookies are HttpOnly and transmitted securely.</p>
      </section>
    </main>
  );
}
