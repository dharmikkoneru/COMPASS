import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../lib/errors';
import { validatePassword } from '../lib/password';
import { supabase } from '../lib/supabase';

/**
 * Lands here from the "reset your password" email (recovery links redirect to
 * /reset-password). Supabase exchanges the token in the URL hash for a
 * session, which unlocks updateUser({ password }). Note: Supabase invalidates
 * other sessions after a password change — that is the desired security
 * behavior, and the copy below explains it so it doesn't look like a bug.
 */
export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validatePassword(password);
    if (!v.ok) {
      setError(v.message ?? 'Password does not meet the requirements');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not update password'));
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-md bg-black/25 border border-white/10 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40 transition';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gradient-brand">Set a new password</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Choose a strong password. Other signed-in devices will be signed out for safety.
          </p>
        </div>

        <form onSubmit={submit} className="glass rounded-xl p-6 space-y-4 shadow-md">
          <input
            className={input}
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            className={input}
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full btn-gradient disabled:opacity-50 disabled:shadow-none text-white font-medium py-2 rounded-md"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Didn't request this? Your account is safe — just ignore the email.
          </p>
        </form>

        <p className="text-center mt-4">
          <Link to="/login" className="text-xs text-gray-600 hover:text-gray-400">
            ← back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
