import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/errors';
import { isGuestEmail } from '../lib/guest';
import { validatePassword } from '../lib/password';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

/**
 * Account settings: profile summary + change password.
 *
 * Re-authentication: GoTrue's updateUser({ password }) requires the session
 * that the recovery link or an active sign-in provides. Rather than fake a
 * sudo mode, the form asks for the CURRENT password and verifies it with a
 * real signInWithPassword against the same account before applying the
 * change — a wrong current password fails before the update is sent.
 */
export default function Settings() {
  const { session, profile, refreshProfile } = useAuth();
  const email = session?.user.email ?? '';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOAuth = session?.user.app_metadata?.provider !== undefined
    && session.user.app_metadata.provider !== 'email';
  // The shared guest demo account must not be able to rotate its own
  // credential — one judge changing it would lock every other judge out.
  const isGuest = isGuestEmail(email);
  const managedExternally = isOAuth || isGuest;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);

    const v = validatePassword(newPassword);
    if (!v.ok) {
      setError(v.message ?? 'Password does not meet the requirements');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match');
      return;
    }

    setBusy(true);
    try {
      // Verify current credentials first (re-authentication).
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) throw new Error('Current password is incorrect');

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setOk('Password updated. Other devices have been signed out for safety.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      await refreshProfile();
    } catch (err) {
      setError(errorMessage(err, 'Could not update password'));
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-md bg-black/25 border border-white/10 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40 transition';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Your account and security preferences.</p>
      </div>

      <section className="glass rounded-xl p-6 shadow-md">
        <h2 className="font-semibold text-white mb-4">Profile</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">Name</dt>
          <dd className="text-white">{profile?.full_name ?? '—'}</dd>
          <dt className="text-gray-500">Email</dt>
          <dd className="text-white">{email || '—'}</dd>
          <dt className="text-gray-500">Department</dt>
          <dd className="text-white">{profile?.department ?? '—'}</dd>
          <dt className="text-gray-500">Designation</dt>
          <dd className="text-white">{profile?.designation ?? '—'}</dd>
          <dt className="text-gray-500">Role</dt>
          <dd className="text-white capitalize">{profile?.role ?? '—'}</dd>
        </dl>
      </section>

      <section className="glass rounded-xl p-6 shadow-md">
        <h2 className="font-semibold text-white mb-1">Change password</h2>
        <p className="text-xs text-gray-500 mb-4">
          {managedExternally
            ? isGuest
              ? 'The guest demo account is managed by the deployment — password changes are disabled.'
              : 'You sign in with an external provider — password changes are managed there.'
            : 'Verify your current password, then choose a strong new one.'}
        </p>

        {managedExternally ? (
          <p className="text-sm text-amber-300">
            Password changes are handled by your sign-in provider, not COMPASS.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              className={input}
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <input
              className={input}
              type="password"
              placeholder="New password (10+ chars, upper & lower case, number)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <input
              className={input}
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />

            {error && <p className="text-sm text-red-400">{error}</p>}
            {ok && <p className="text-sm text-green-400">{ok}</p>}

            <button
              type="submit"
              disabled={busy}
              className="btn-gradient disabled:opacity-50 disabled:shadow-none text-white font-medium py-2 px-4 rounded-md"
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
