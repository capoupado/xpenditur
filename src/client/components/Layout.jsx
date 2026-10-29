import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/insights', label: 'Insights' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/categories', label: 'Categories' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/recurring', label: 'Recurring' },
  { to: '/pending', label: 'Pending', badgeKey: 'pending' },
  { to: '/settings', label: 'Settings' },
];

// Active items get a lime wash bleeding to the right plus a hard left rule —
// the reference design's way of marking place without a rounded pill.
const ACTIVE_NAV =
  'font-bold text-lime-50 border-l-2 border-lime bg-gradient-to-r from-lime/[.22] to-lime/[.02]';
const IDLE_NAV = 'font-medium text-cream-muted border-l-2 border-transparent hover:text-cream hover:bg-cream-film';

function NavLinks({ onClick, badges }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onClick}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2.5 text-[13.5px] transition-colors ${
              isActive ? ACTIVE_NAV : IDLE_NAV
            }`
          }
        >
          <span>{item.label}</span>
          {item.badgeKey && badges[item.badgeKey] > 0 && (
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center bg-lime px-1.5 text-[11px] font-extrabold text-ink shadow-[0_0_16px_rgba(167,201,87,.55)]">
              {badges[item.badgeKey]}
            </span>
          )}
        </NavLink>
      ))}
    </>
  );
}

// Blurred color blooms behind everything — fixed, non-interactive, z-0.
function Atmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -left-[180px] -top-[300px] h-[780px] w-[780px] animate-bloom bg-[radial-gradient(circle,rgba(56,102,65,.62),rgba(56,102,65,0)_66%)] blur-[34px]" />
      <div className="absolute -right-[200px] top-[80px] h-[700px] w-[700px] animate-bloom-slow bg-[radial-gradient(circle,rgba(167,201,87,.20),rgba(167,201,87,0)_66%)] blur-[36px]" />
      <div className="absolute -bottom-[260px] left-[26%] h-[520px] w-[660px] bg-[radial-gradient(ellipse,rgba(188,71,73,.26),rgba(188,71,73,0)_68%)] blur-[38px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/30 to-ink/70" />
    </div>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-3 w-3 bg-lime shadow-[0_0_18px_rgba(167,201,87,.85)]" />
      <span className="text-base font-extrabold tracking-tighter">xPenditur</span>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [badges, setBadges] = useState({ pending: 0 });

  useEffect(() => {
    let cancelled = false;
    const loadCount = () =>
      api
        .get('/pending/count')
        .then((res) => {
          if (!cancelled) setBadges((b) => ({ ...b, pending: res.pending || 0 }));
        })
        .catch(() => {});
    loadCount();
    // Refresh periodically so the badge tracks the daily bank sync.
    const t = setInterval(loadCount, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="relative isolate min-h-screen bg-ink text-cream">
      <Atmosphere />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b border-cream-line bg-cream-film px-4 py-3 backdrop-blur-xl md:hidden">
          <Wordmark />
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="border border-cream-line px-3 py-1.5 text-cream-muted hover:text-cream"
            aria-label="Toggle menu"
          >
            ☰
          </button>
        </div>
        {menuOpen && (
          <div className="flex flex-col border-b border-cream-line bg-cream-film pb-3 backdrop-blur-xl md:hidden">
            <NavLinks onClick={() => setMenuOpen(false)} badges={badges} />
            <button
              onClick={handleLogout}
              className="px-3 py-2.5 text-left text-[13.5px] font-medium text-cream-muted hover:text-brick-light"
            >
              Log out
            </button>
          </div>
        )}

        {/* Sidebar (desktop) */}
        <nav className="hidden shrink-0 flex-col gap-0.5 border-r border-cream-line bg-gradient-to-b from-cream/[.07] to-cream/[.02] px-4 py-[22px] shadow-[inset_1px_0_0_rgba(242,232,207,.08)] backdrop-blur-[26px] md:flex md:w-[248px]">
          <div className="px-3 pb-2 pt-1">
            <Wordmark />
          </div>
          <div className="mx-3 mb-4 mt-2.5 h-0.5 bg-cream/[.16]" />

          <div className="flex flex-1 flex-col gap-0.5">
            <NavLinks badges={badges} />
          </div>

          <div className="mt-auto border-t-2 border-cream/[.16] px-3 pb-1.5 pt-3.5">
            <p className="text-[11px] tracking-[.04em] text-cream-faint">
              SIGNED IN — <span className="text-cream-dim">{user?.username?.toUpperCase()}</span>
            </p>
            <button
              onClick={handleLogout}
              className="mt-2 text-xs font-semibold text-cream-muted transition-colors hover:text-brick-light"
            >
              Log out
            </button>
          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-10 pt-6 sm:px-[clamp(16px,3vw,30px)]">
          {children}
        </main>
      </div>
    </div>
  );
}
