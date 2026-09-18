import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../lib/errors';
import { passwordStrength, passwordIssues, validatePassword } from '../lib/password';
import { clearFailures, formatLockDuration, getLockState, recordFailure } from '../lib/loginThrottle';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup' | 'forgot';

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpStage, setOtpStage] = useState<'email' | 'code'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const navigate = useNavigate();
  // ProtectedRoute records where the officer was headed when it bounced them
  // here. Landing on "/" instead made every deep link a two-step trip.
  const location = useLocation();
  const requested = (location.state as { from?: string } | null)?.from;
  const destination = requested && requested !== '/login' ? requested : '/';

  // 60s cooldown so the officer can't spam recovery emails.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const resendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResendIn(60);
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const v = validatePassword(password);
        if (!v.ok) {
          setError(v.message ?? 'Password does not meet the requirements');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, department, designation },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate(destination, { replace: true });
        } else {
          setNotice('Account created. Check your email to confirm, then sign in.');
        }
      } else if (mode === 'forgot') {
        if (otpStage === 'email') {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
          });
          if (error) throw error;
          setOtpStage('code');
          setResendIn(60);
        } else {
          const { error } = await supabase.auth.verifyOtp({
            email,
            token: otpCode.trim(),
            type: 'recovery',
          });
          if (error) {
            const raw = errorMessage(error, 'Verification failed');
            throw new Error(
              /expired|invalid/i.test(raw)
                ? 'That code is invalid or has expired. Request a new one and try again.'
                : raw,
            );
          }
          // Recovery session granted — /reset-password can now updateUser({ password }).
          navigate('/reset-password', { replace: true });
        }
      } else {
        // Brute-force throttle (client side; server-side limits are GoTrue's).
        const lock = getLockState(email);
        if (lock.locked) {
          setError(`Too many failed attempts. Try again in ${formatLockDuration(lock.retryInSec)}.`);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          recordFailure(email);
          const after = getLockState(email);
          setError(
            after.locked
              ? `Too many failed attempts. Try again in ${formatLockDuration(after.retryInSec)}.`
              : `${errorMessage(error, 'Authentication failed')} (${after.attemptsLeft} attempt${after.attemptsLeft === 1 ? '' : 's'} left)`,
          );
          return;
        }
        clearFailures(email);
        navigate(destination, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err, 'Authentication failed'));
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
          <h1 className="text-4xl font-bold tracking-tight text-gradient-brand">COMPASS Platform</h1>
          <p className="text-gray-400 mt-1">
            AI competency &amp; training for India's Official Statistical System
          </p>
          <p className="text-gray-600 text-xs mt-1">SIH26101 · MoSPI · Smart Education</p>
        </div>

        <form onSubmit={submit} className="glass rounded-xl p-6 space-y-4 shadow-md">
          <div className="flex rounded-md overflow-hidden border border-white/10">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setNotice(null);
                  setOtpStage('email');
                  setOtpCode('');
                  setResendIn(0);
                }}
                className={`flex-1 py-2 text-sm font-medium transition ${
                  mode === m ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {mode === 'signup' && (
            <>
              <input
                className={input}
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
              <input
                className={input}
                placeholder="Department (e.g. NSO Field Operations Division)"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
              <input
                className={input}
                placeholder="Designation (e.g. Junior Statistical Officer)"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </>
          )}

          <input
            className={input}
            type="email"
            placeholder="Official email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {mode !== 'forgot' && (
            <input
              className={input}
              type="password"
              placeholder={mode === 'signup' ? 'Password (10+ chars, upper & lower case, number)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'signup' ? 10 : 6}
              required
            />
          )}

          {mode === 'signup' && password.length > 0 && (() => {
            const strength = passwordStrength(password);
            const missing = passwordIssues(password).map((i) => i.message);
            const labels = ['', 'Weak', 'Good', 'Strong'];
            const colors = ['bg-red-500', 'bg-red-500', 'bg-amber-400', 'bg-green-400'];
            return (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className={`h-1 flex-1 rounded-full ${n <= strength ? colors[strength] : 'bg-white/10'} transition`}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {missing.length > 0 ? `Needs: ${missing.join(', ')}` : `${labels[strength]} password`}
                </p>
              </div>
            );
          })()}

          {mode === 'forgot' && otpStage === 'email' && (
            <p className="text-xs text-gray-500">
              Enter your official email and we'll send a 6-digit reset code.
            </p>
          )}

          {mode === 'forgot' && otpStage === 'code' && (
            <div className="space-y-3">
              <p className="text-sm text-green-400">
                Code sent to {email}. It expires in 60 minutes — check your inbox.
              </p>
              <input
                className={`${input} text-center font-mono tracking-[0.4em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                required
              />
              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={() => void resendCode()}
                className="w-full text-xs text-gray-400 hover:text-white underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code available in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-green-400">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full btn-gradient disabled:opacity-50 disabled:shadow-none text-white font-medium py-2 rounded-md"
          >
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Sign up'
                  : otpStage === 'email'
                    ? 'Send reset code'
                    : 'Verify code'}
          </button>

          {mode === 'signin' && (
            <>
              <div className="flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] uppercase tracking-wider text-gray-500">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    const { error } = await supabase.auth.signInWithOAuth({
                      provider: 'google',
                      options: { redirectTo: window.location.origin },
                    });
                    if (error) throw error;
                  } catch (err) {
                    setError(errorMessage(err, 'Google sign-in failed'));
                    setBusy(false);
                  }
                }}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-medium py-2 rounded-md transition disabled:opacity-50"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  Sign in with Google
                </span>
              </button>
            </>
          )}

          {mode === 'signin' ? (
            <p className="text-xs text-center">
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setOtpStage('email');
                  setOtpCode('');
                  setResendIn(0);
                }}
                className="text-gray-400 hover:text-white underline underline-offset-2"
              >
                Forgot password?
              </button>
            </p>
          ) : (
            <p className="text-xs text-center">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setOtpStage('email');
                  setOtpCode('');
                  setResendIn(0);
                }}
                className="text-gray-400 hover:text-white underline underline-offset-2"
              >
                ← back to sign in
              </button>
            </p>
          )}

          <p className="text-xs text-gray-500 text-center">
            New officer? Create an account — your profile is provisioned automatically.
            First account? Promote it to admin in Supabase (see SUPABASE_SETUP.md).
          </p>
        </form>

        <p className="text-center mt-4">
          <Link to="/" className="text-xs text-gray-600 hover:text-gray-400">
            ← back to overview
          </Link>
        </p>
      </div>
    </div>
  );
}
