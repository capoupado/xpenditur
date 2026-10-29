import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(username, password);
      toast.success('Welcome back');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-ink px-4 text-cream">
      {/* Same atmosphere as the app shell so the sign-in feels like the product. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -left-[180px] -top-[240px] h-[720px] w-[720px] animate-bloom bg-[radial-gradient(circle,rgba(56,102,65,.62),rgba(56,102,65,0)_66%)] blur-[34px]" />
        <div className="absolute -right-[200px] bottom-[-200px] h-[640px] w-[640px] animate-bloom-slow bg-[radial-gradient(circle,rgba(167,201,87,.20),rgba(167,201,87,0)_66%)] blur-[36px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/30 to-ink/70" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="h-3 w-3 bg-lime shadow-[0_0_18px_rgba(167,201,87,.85)]" />
          <span className="text-lg font-extrabold tracking-tighter">xPenditur</span>
        </div>

        <form onSubmit={handleSubmit} className="xp-panel space-y-4">
          <div>
            <div className="xp-eyebrow">Welcome back</div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight">Sign in to your ledger</h1>
          </div>

          <div>
            <label className="mb-1.5 block xp-eyebrow-dim" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="xp-input"
            />
          </div>
          <div>
            <label className="mb-1.5 block xp-eyebrow-dim" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="xp-input"
            />
          </div>
          <button type="submit" disabled={submitting} className="xp-btn-primary w-full py-2.5 disabled:opacity-50">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
