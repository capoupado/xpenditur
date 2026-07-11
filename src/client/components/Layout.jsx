import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/transactions', label: 'Transactions', icon: '💸' },
  { to: '/categories', label: 'Categories', icon: '🏷️' },
  { to: '/budgets', label: 'Budgets', icon: '🎯' },
  { to: '/recurring', label: 'Recurring', icon: '🔁' },
];

function NavLinks({ onClick }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onClick}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-emerald-600/20 text-emerald-400'
                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
            }`
          }
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-950 text-gray-100">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="font-semibold text-lg">xPenditur</span>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-2 rounded-lg hover:bg-gray-800"
          aria-label="Toggle menu"
        >
          ☰
        </button>
      </div>
      {menuOpen && (
        <div className="md:hidden flex flex-col gap-1 px-3 pb-3 border-b border-gray-800">
          <NavLinks onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:min-h-screen border-r border-gray-800 px-3 py-6">
        <div className="px-4 mb-8">
          <span className="font-bold text-xl">xPenditur</span>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          <NavLinks />
        </nav>
        <div className="px-4 pt-4 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2">Signed in as {user?.username}</p>
          <button
            onClick={handleLogout}
            className="w-full text-left text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
