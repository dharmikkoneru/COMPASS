import { useMemo, useState } from 'react';
import { useAllProfiles } from '../hooks/useAllProfiles';
import { directoryStats, filterDirectory, readinessLabel } from '../lib/adminUsers';
import { relativeTime } from '../lib/attempts';
import { useAuth } from '../context/AuthContext';
import { isGuestEmail } from '../lib/guest';
import { GAP_THRESHOLD } from '../lib/competencies';

/**
 * Administrative directory — every account record in one restricted view.
 *
 * Credentials are absent by construction, not by filtering: password hashes
 * live in auth.users, which the API never exposes. Role changes are allowed
 * by the existing profiles_update_admin policy, with a guard against
 * demoting yourself out of the admin area.
 */
export default function AdminUsers() {
  const { session } = useAuth();
  const { rows, loading, error, refresh, setRole } = useAllProfiles(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = useMemo(() => filterDirectory(rows, query), [rows, query]);
  const stats = useMemo(() => directoryStats(rows), [rows]);
  const meId = session?.user.id;

  const toggleRole = async (id: string, current: 'officer' | 'admin') => {
    setActionError(null);
    setBusyId(id);
    try {
      await setRole(id, current === 'admin' ? 'officer' : 'admin');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the role');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <p className="text-sm text-gray-400">
          Account records only — credentials are never shown, because they live in
          Supabase auth and are not reachable from this API.
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="shrink-0 text-sm text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 disabled:opacity-40 px-3 py-1.5 rounded transition"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {[
          ['Accounts', String(stats.total)],
          ['Admins', String(stats.admins)],
          ['Departments', String(stats.departments)],
          ['Assessed', `${stats.assessed}/${stats.total}`],
        ].map(([label, value]) => (
          <div key={label} className="glass px-4 py-2 rounded-lg">
            <span className="text-gray-500 text-xs uppercase tracking-wider">{label}</span>
            <p className="text-white font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, email, department or designation…"
        className="w-full rounded-md bg-black/25 border border-white/10 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40 transition"
      />

      {(error || actionError) && <p className="text-sm text-red-400">{error ?? actionError}</p>}
      {loading && <p className="text-gray-400 text-sm">Loading accounts…</p>}

      {!loading && visible.length === 0 && (
        <p className="text-gray-500 text-sm">
          {rows.length === 0 ? 'No accounts found.' : `No account matches “${query.trim()}”.`}
        </p>
      )}

      {!loading && visible.length > 0 && (
        <div className="glass rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-[11px] uppercase tracking-wider">
                <th className="pb-2 pr-3 font-medium">Officer</th>
                <th className="pb-2 pr-3 font-medium">Department</th>
                <th className="pb-2 pr-3 font-medium">Designation</th>
                <th className="pb-2 pr-3 font-medium">Role</th>
                <th className="pb-2 pr-3 font-medium text-right">Assessments</th>
                <th className="pb-2 pr-3 font-medium text-right">Readiness</th>
                <th className="pb-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {visible.map((r) => (
                <tr key={r.id} className="text-gray-200">
                  <td className="py-2 pr-3">
                    <span className="text-sm">{r.fullName}</span>
                    {isGuestEmail(r.email) && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                        DEMO
                      </span>
                    )}
                    <p className="text-xs text-gray-500 break-all">{r.email}</p>
                  </td>
                  <td className="py-2 pr-3 text-gray-300">{r.department}</td>
                  <td className="py-2 pr-3 text-gray-300">{r.designation}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        r.role === 'admin'
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : 'bg-white/5 border-white/15 text-gray-300'
                      }`}
                    >
                      {r.role}
                    </span>
                    {/* The shared guest account may not be promoted: its password is
                        public, so admin rights there would expose the directory. The
                        database enforces this too (0011 protect_guest_role). */}
                    {isGuestEmail(r.email) ? (
                      <span className="ml-2 text-[11px] text-gray-500">shared demo — locked</span>
                    ) : (
                      r.id !== meId && (
                        <button
                          onClick={() => void toggleRole(r.id, r.role)}
                          disabled={busyId === r.id}
                          className="ml-2 text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2 disabled:opacity-40"
                        >
                          {busyId === r.id ? 'saving…' : r.role === 'admin' ? 'demote' : 'promote'}
                        </button>
                      )
                    )}
                    {r.id === meId && <span className="ml-2 text-[11px] text-gray-600">you</span>}
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-300">{r.assessments}</td>
                  <td
                    className={`py-2 pr-3 text-right font-medium ${
                      r.readiness === null
                        ? 'text-gray-600'
                        : r.readiness >= GAP_THRESHOLD
                          ? 'text-green-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {readinessLabel(r.readiness)}
                  </td>
                  <td className="py-2 text-gray-400 whitespace-nowrap">{relativeTime(r.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-500 mt-3">
            {visible.length} of {rows.length} account{rows.length === 1 ? '' : 's'} shown.
            Readiness averages each officer's assessed competencies; “Not assessed” means no quiz
            attempts yet.
          </p>
        </div>
      )}
    </div>
  );
}
