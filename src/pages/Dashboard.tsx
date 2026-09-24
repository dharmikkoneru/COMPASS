import { Link } from 'react-router-dom';
import CompetencyRadar from '../components/CompetencyRadar';
import ForecastPanel from '../components/ForecastPanel';
import { useAttempts } from '../hooks/useAttempts';
import { useCompetencyProfile } from '../hooks/useCompetencyProfile';
import { COMPETENCIES, COMPETENCY_SHORT, GAP_THRESHOLD, displayMastery } from '../lib/competencies';
import { averageScore, relativeTime, summarizeAttempts } from '../lib/attempts';
import { diagnose, overallReadiness } from '../lib/gapEngine';

const COMPETENCY_COUNT = COMPETENCIES.length;

const HISTORY_LIMIT = 5;

export default function Dashboard() {
  const { rows, loading, error, refresh: refreshProfile } = useCompetencyProfile();
  const {
    attempts,
    titles,
    loading: historyLoading,
    refresh: refreshHistory,
  } = useAttempts(HISTORY_LIMIT);
  const busy = loading || historyLoading;
  const { strengths, gaps } = diagnose(rows);
  const readiness = overallReadiness(rows);
  const assessed = rows.length > 0;
  const history = summarizeAttempts(attempts, titles, HISTORY_LIMIT);
  const meanScore = averageScore(history);

  return (
    <div className="space-y-6">
      <header className="border-b border-gray-700 pb-4 flex justify-between items-start gap-4">
        <div>
          <h2 className="text-3xl font-bold text-blue-400">COMPASS Diagnostic Overview</h2>
          <p className="text-gray-400 mt-1">
            MoSPI officer competency mapping — live from your quiz attempts
          </p>
        </div>
        <button
          onClick={() => {
            refreshProfile();
            refreshHistory();
          }}
          disabled={busy}
          className="shrink-0 text-sm text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 disabled:opacity-40 px-3 py-1.5 rounded transition"
        >
          ↻ Refresh
        </button>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-gray-400">Loading your competency profile…</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass p-6 rounded-lg">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
                Overall Readiness
              </h3>
              <p
                className={`text-4xl font-bold mt-2 drop-shadow-[0_0_12px_rgba(124,58,237,0.5)] ${
                  readiness >= 60 ? 'text-green-400' : 'text-amber-400'
                }`}
              >
                {readiness}%
              </p>
              <p className="text-sm text-gray-500 mt-1">
                mean mastery across {COMPETENCY_COUNT} competencies
                {meanScore !== null && ` · last ${history.length} attempt${history.length > 1 ? 's' : ''} averaged ${meanScore}%`}
              </p>
            </div>

            <div className="glass p-6 rounded-lg">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
                Identified Gaps
              </h3>
              <p className="text-4xl font-bold text-red-400 mt-2 drop-shadow-[0_0_12px_rgba(244,63,94,0.4)]">{gaps.length}</p>
              <p className="text-sm text-gray-500 mt-1">
                {assessed
                  ? `below ${GAP_THRESHOLD}% mastery`
                  : 'take a quiz to begin diagnosis'}
              </p>
            </div>

            <div className="glass p-6 rounded-lg">
              <h3 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
                Top Strength
              </h3>
              {strengths.length > 0 ? (
                <>
                  <p className="text-xl font-bold text-blue-300 mt-2">
                    {COMPETENCY_SHORT[strengths[0].competency]}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {displayMastery(strengths[0].mastery)}% mastery
                  </p>
                </>
              ) : (
                <p className="text-gray-500 text-sm mt-3">
                  {assessed ? 'No competency above threshold yet.' : '—'}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass p-6 rounded-lg">
              <h3 className="font-semibold text-white mb-2">Competency Radar</h3>
              <p className="text-xs text-gray-500 mb-2">
                Inside the {GAP_THRESHOLD}% ring = a gap needing training.
              </p>
              <CompetencyRadar rows={rows} />
            </div>

            <div className="space-y-6">
              <div className="glass p-6 rounded-lg">
                <h3 className="font-semibold text-white mb-3">
                  Gaps <span className="text-gray-500 text-sm">(most urgent first)</span>
                </h3>
                {gaps.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    {assessed
                      ? 'No gaps — all assessed competencies are at or above 60%.'
                      : 'No data yet. Generate a quiz from learning material and take it.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {gaps.map((g) => (
                      <span
                        key={g.competency}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                          g.mastery < GAP_THRESHOLD / 2
                            ? 'bg-red-900/40 border-red-700 text-red-300'
                            : 'bg-amber-900/30 border-amber-700 text-amber-300'
                        }`}
                      >
                        {g.competency} · {displayMastery(g.mastery)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass p-6 rounded-lg">
                <h3 className="font-semibold text-white mb-3">Next best actions</h3>
                <div className="space-y-2">
                  <Link
                    to="/materials"
                    className="block bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/50 rounded px-4 py-3 text-sm transition"
                  >
                    📄 Upload learning material → generate an AI quiz
                  </Link>
                  <Link
                    to="/recommendations"
                    className="block bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/50 rounded px-4 py-3 text-sm transition"
                  >
                    🎓{' '}
                    {gaps.length > 0
                      ? `Training for your ${gaps.length} gap${gaps.length > 1 ? 's' : ''} on iGOT Karmayogi`
                      : 'Browse iGOT Karmayogi recommendations'}
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <ForecastPanel rows={rows} readiness={readiness} />

          <div className="glass p-6 rounded-lg">
            <div className="flex justify-between items-baseline">
              <h3 className="font-semibold text-white">
                Attempt history{' '}
                <span className="text-gray-500 text-sm">(every mastery update starts here)</span>
              </h3>
              {history.length > 0 && (
                <Link to="/materials" className="text-xs text-blue-400 hover:underline">
                  Take another quiz →
                </Link>
              )}
            </div>

            {historyLoading ? (
              <p className="text-gray-500 text-sm mt-3">Loading attempt history…</p>
            ) : history.length === 0 ? (
              <p className="text-gray-500 text-sm mt-3">
                No attempts yet — generate a quiz from your learning material and submit it to
                start building evidence.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-700">
                {history.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0 break-words">
                      <Link
                        to={`/quiz/${a.quizId}`}
                        className="text-sm text-gray-100 hover:text-blue-300 truncate block transition"
                      >
                        {a.title}
                      </Link>
                      <p className="text-xs text-gray-500">{relativeTime(a.submittedAt)}</p>
                    </div>
                    <span
                      className={`text-sm font-medium shrink-0 ${
                        a.percent >= GAP_THRESHOLD ? 'text-green-400' : 'text-amber-400'
                      }`}
                    >
                      {a.score}/{a.total} · {a.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
