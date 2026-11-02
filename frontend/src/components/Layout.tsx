import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/audits/new', label: 'New audit', end: true },
  { to: '/audits', label: 'Audit history', end: true }
];

export function Logo() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-white text-xs font-bold text-[#1d2c47]" aria-hidden>
      WA
    </span>
  );
}

export function Layout() {
  const { userId, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLink = ({ isActive }: { isActive: boolean }) =>
    `block rounded-control px-3.5 py-2 text-[15px] font-semibold transition-colors ${
      isActive ? 'bg-white/[0.14] text-white' : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
    }`;
  const barButton = 'btn btn-sm border border-white/25 text-white hover:bg-white/10 focus-visible:ring-white/70 focus-visible:ring-offset-bar';

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-white/5 bg-bar text-white dark:border-line">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 sm:px-8">
          <NavLink to="/" className="flex shrink-0 items-center gap-3 rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Logo />
            <span className="text-base font-semibold">Website Audit</span>
          </NavLink>
          <nav className="hidden flex-1 gap-1 md:flex" aria-label="Main">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLink}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-4 md:flex">
            <span className="text-sm text-white/70">
              Signed in as <span className="font-semibold text-white">{userId}</span>
            </span>
            <button type="button" className={barButton} onClick={() => void logout()}>
              Sign out
            </button>
          </div>
          <button
            type="button"
            className={`${barButton} ml-auto md:hidden`}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-menu" className="space-y-1 border-t border-white/10 px-5 pb-4 pt-3 md:hidden" aria-label="Main">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLink} onClick={() => setMenuOpen(false)}>
                {link.label}
              </NavLink>
            ))}
            <div className="!mt-3 flex items-center justify-between border-t border-white/10 pt-4 text-sm text-white/70">
              <span>
                Signed in as <span className="font-semibold text-white">{userId}</span>
              </span>
              <button type="button" className={barButton} onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <Outlet />
      </main>
    </div>
  );
}
