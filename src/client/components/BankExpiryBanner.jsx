import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

export function expiryText(conn) {
  if (conn.days_left < 0) return `expired on ${conn.expires_on}`;
  if (conn.days_left === 0) return 'expires today';
  return `expires in ${conn.days_left} day${conn.days_left === 1 ? '' : 's'} (${conn.expires_on})`;
}

// Sends the browser to the bank's consent page for the same bank; the new
// session replaces the old connection server-side (enablebanking.js).
export async function reconnectBank(conn) {
  const { url } = await api.post('/bank/connect', { aspsp_name: conn.aspsp_name, country: conn.aspsp_country });
  window.location.href = url;
}

// App-wide warning for bank consents that are about to lapse — once one
// expires, syncing silently stops, so this stays visible until reconnected.
export default function BankExpiryBanner() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.get('/bank/expiry').then(setItems).catch(() => {});
  }, []);

  if (items.length === 0) return null;

  const reconnect = async (conn) => {
    setBusy(conn.id);
    try {
      await reconnectBank(conn);
    } catch (err) {
      toast.error(err.message);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((conn) => {
        const urgent = conn.days_left <= 3;
        return (
          <div
            key={conn.id}
            className={`flex flex-wrap items-center gap-3 border px-4 py-2.5 text-[13px] backdrop-blur-xl ${
              urgent ? 'border-brick/60 bg-brick/[.16] text-cream' : 'border-amber-500/40 bg-amber-500/[.10] text-cream'
            }`}
          >
            <span className="font-semibold">⏳ {conn.aspsp_name} bank consent {expiryText(conn)}.</span>
            <span className="text-cream-muted">Bank sync stops when it lapses.</span>
            <button
              onClick={() => reconnect(conn)}
              disabled={busy === conn.id}
              className="ml-auto border border-cream-line px-3 py-1 text-xs font-bold text-cream hover:bg-cream-film disabled:opacity-50"
            >
              {busy === conn.id ? 'Redirecting…' : 'Reconnect'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
