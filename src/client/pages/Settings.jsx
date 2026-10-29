import React from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import NotificationSettings from './settings/NotificationSettings.jsx';
import AutomationSettings from './settings/AutomationSettings.jsx';
import AiSettings from './settings/AiSettings.jsx';
import BankSettings from './settings/BankSettings.jsx';
import AccountSettings from './settings/AccountSettings.jsx';

// Each tab is its own page under /settings/<path>, so a new group of
// settings is one file plus one entry here.
const TABS = [
  { path: 'notifications', label: 'Notifications', element: <NotificationSettings /> },
  { path: 'automation', label: 'Automation', element: <AutomationSettings /> },
  { path: 'ai', label: 'AI provider', element: <AiSettings /> },
  { path: 'bank', label: 'Bank sync', element: <BankSettings /> },
  { path: 'account', label: 'Account', element: <AccountSettings /> },
];

function SettingsIndex() {
  // Older bank-consent redirects land on /settings?bank=…; keep the query.
  const { search } = useLocation();
  const target = new URLSearchParams(search).has('bank') ? 'bank' : TABS[0].path;
  return <Navigate to={`${target}${search}`} replace />;
}

export default function Settings() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-tighter mb-1">Settings</h1>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-cream-line">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `-mb-px shrink-0 border-b-2 px-3.5 py-2 text-[13px] transition-colors ${
                isActive ? 'border-lime font-bold text-cream' : 'border-transparent font-medium text-cream-muted hover:text-cream'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<SettingsIndex />} />
        {TABS.map((tab) => (
          <Route key={tab.path} path={tab.path} element={tab.element} />
        ))}
        <Route path="*" element={<Navigate to={TABS[0].path} replace />} />
      </Routes>
    </div>
  );
}
