import { FormEvent, useState } from 'react';
import { Logo } from '../components/Layout';
import { Alert, SeverityStrip } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId.trim() || !password) {
      setError('Enter your ID and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(userId.trim(), password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-bar px-12 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-base font-semibold">Website Audit</span>
        </div>
        <div className="max-w-[30rem]">
          <p className="text-2xl font-semibold leading-snug">
            Crawl a website, check every page in every viewport, and see what to fix first.
          </p>
          {/* Illustration of the severity strip used on results pages, not real data. */}
          <div className="mt-8" aria-hidden>
            <SeverityStrip summary={{ critical: 2, high: 7, medium: 14, low: 5 }} size="sm" />
          </div>
          <p className="mt-3 text-sm text-white/60">Every audit ends with its issues sorted from critical to low.</p>
        </div>
        <p className="text-sm text-white/50">Playwright Website Audit Framework</p>
      </aside>

      <div className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[380px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="rounded-control bg-bar p-1">
              <Logo />
            </span>
            <span className="text-base font-semibold">Website Audit</span>
          </div>
          <h1 className="text-2xl tracking-tight">Sign in</h1>
          <p className="mt-2 text-ink-2">Use your dashboard ID and password.</p>
          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
            {error && <Alert>{error}</Alert>}
            <div>
              <label className="label" htmlFor="userId">
                ID
              </label>
              <input
                id="userId"
                className="input"
                autoComplete="username"
                inputMode="numeric"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full py-3 text-base" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
