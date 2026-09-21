import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminUsers from '../components/AdminUsers';
import { useAllMastery } from '../hooks/useCompetencyProfile';
import { COMPETENCIES, COMPETENCY_SHORT, GAP_THRESHOLD } from '../lib/competencies';
import { useAuth } from '../context/AuthContext';

function heatColor(mastery: number): string {
  if (mastery <= 0) return 'bg-gray-800 text-gray-700';
  if (mastery >= 75) return 'bg-green-600/80';
  if (mastery >= GAP_THRESHOLD) return 'bg-green-800/70 text-green-200';
  if (mastery >= 40) return 'bg-amber-700/70 text-amber-100';
  return 'bg-red-700/80 text-red-100';
}

type AdminTab = 'heatmap' | 'users';

export default function Admin() {
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [tab, setTab] = useState<AdminTab>('heatmap');
  const { rows, loading, error } = useAllMastery(isAdmin);

  const byDept = useMemo(() => {
    const depts = new Map<
      string,
      { totals: Record<string, { sum: number; n: number }> }
    >();
    for (const r of rows) {
      const dept = r.department ?? 'Unassigned';
      const d = depts.get(dept) ?? { totals: {} };
      const t = d.totals[r.competency_tag] ?? { sum: 0, n: 0 };
      t.sum += r.mastery;
      t.n += 1;
      d.totals[r.competency_tag] = t;
      depts.set(dept, d);
    }
    return [...depts.entries()].map(([dept, d]) => {
      const cells = COMPETENCIES.map((c) => {
        const t = d.totals[c];
        return t ? Math.round(t.sum / t.n) : 0;
      });
      const readiness = Math.round(cells.reduce((a, b) => a + b, 0) / COMPETENCIES.length);
      return { dept, cells, readiness };
    });
  }, [rows]);

  if (authLoading) return <p className="text-gray-400">Loading…</p>;

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 space-y-3">
        <h2 className="text-2xl font-bold text-white">Admin only</h2>
        <p className="text-gray-400 text-sm">
          Your account doesn't have the admin role. Promote a user in Supabase:
        </p>
        <pre className="text-left text-xs bg-black/30 border border-white/10 rounded p-4 overflow-x-auto text-gray-300">{`update public.profiles
set role = 'admin'
where email = 'you@example.com';`}</pre>
        <Link to="/" className="text-blue-400 text-sm hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-gray-700 pb-4 flex flex-wrap justify-between items-end gap-3">
        <div>
          <h2 className="text-3xl font-bold text-amber-400">
            {tab === 'users' ? 'User Accounts' : 'Org Competency Heatmap'}
          </h2>
          <p className="text-gray-400 mt-1">
            {tab === 'users'
              ? 'Every account record in one restricted view — credentials are never exposed.'
              : 'Mean mastery per competency across departments — plan training drives from evidence.'}
          </p>
        </div>
        <div className="flex rounded-md overflow-hidden border border-white/10">
          {(['heatmap', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs sm:text-sm transition ${
                tab === t
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {t === 'heatmap' ? 'Heatmap' : 'User accounts'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'users' && <AdminUsers />}

      {tab === 'heatmap' && (
        <>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-gray-400">Loading org data…</p>}

      {!loading && byDept.length === 0 && (
        <p className="text-gray-500 text-sm">No mastery data yet — officers must take quizzes first.</p>
      )}

      {byDept.length > 0 && (
        <div className="glass rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-sm border-separate" style={{ borderSpacing: '3px' }}>
            <thead>
              <tr>
                <th className="text-left text-gray-400 font-medium pb-2 pr-3">Department</th>
                {COMPETENCIES.map((c) => (
                  <th key={c} className="text-gray-400 font-medium pb-2 px-1 text-[11px]">
                    {COMPETENCY_SHORT[c]}
                  </th>
                ))}
                <th className="text-gray-400 font-medium pb-2 px-2 text-[11px]">Readiness</th>
              </tr>
            </thead>
            <tbody>
              {byDept
                .sort((a, b) => a.readiness - b.readiness)
                .map((d) => (
                  <tr key={d.dept}>
                    <td className="text-gray-200 pr-3 whitespace-nowrap">{d.dept}</td>
                    {d.cells.map((v, i) => (
                      <td
                        key={i}
                        className={`text-center rounded px-2 py-2 font-medium ${heatColor(v)}`}
                        title={`${COMPETENCIES[i]}: ${v}%`}
                      >
                        {v > 0 ? v : '–'}
                      </td>
                    ))}
                    <td className="text-center font-bold text-gray-200">{d.readiness}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
            <span className="inline-block w-4 h-4 rounded bg-red-700/80" /> &lt;40%
            <span className="inline-block w-4 h-4 rounded bg-amber-700/70 ml-2" /> 40–59%
            <span className="inline-block w-4 h-4 rounded bg-green-800/70 ml-2" /> 60–74%
            <span className="inline-block w-4 h-4 rounded bg-green-600/80 ml-2" /> ≥75%
            <span className="ml-2">– = not yet assessed</span>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
