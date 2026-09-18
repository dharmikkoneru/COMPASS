import { useEffect, useRef, useState } from 'react';
import { useCompetencyProfile } from '../hooks/useCompetencyProfile';
import { COMPETENCY_SHORT, GAP_THRESHOLD } from '../lib/competencies';
import { errorMessage } from '../lib/errors';
import { SupabaseMockIgotAdapter, gapsFromMastery } from '../lib/igot/adapter';
import type { Recommendation } from '../lib/types';

const STATUS_STYLES: Record<Recommendation['status'], string> = {
  recommended: 'bg-blue-900/50 text-blue-300 border-blue-700',
  enrolled: 'bg-amber-900/40 text-amber-300 border-amber-700',
  in_progress: 'bg-amber-900/40 text-amber-300 border-amber-700',
  completed: 'bg-green-900/40 text-green-300 border-green-700',
};

export default function Recommendations() {
  const { rows, loading } = useCompetencyProfile();
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const adapter = new SupabaseMockIgotAdapter();
        const gaps = gapsFromMastery(rows, GAP_THRESHOLD);
        // Saving the ranking is best effort, so a write failure comes back as a
        // warning alongside a usable ranking rather than killing the page.
        const { recommendations, warning: saveWarning } = await adapter.listRecommendations(
          gaps,
          rows,
        );
        setRecs(recommendations);
        setWarning(saveWarning);
      } catch (err) {
        setError(errorMessage(err, 'Failed to load recommendations'));
        setRecs([]);
      }
    })();
  }, [loading, rows]);

  const enroll = async (rec: Recommendation) => {
    setBusyId(rec.id);
    setError(null);
    try {
      const adapter = new SupabaseMockIgotAdapter();
      await adapter.enroll(rec.course_id);
      setRecs((prev) =>
        (prev ?? []).map((r) => (r.id === rec.id ? { ...r, status: 'enrolled', progress: 0 } : r)),
      );
    } catch (err) {
      setError(errorMessage(err, 'Enrollment failed'));
    } finally {
      setBusyId(null);
    }
  };

  const setProgress = async (rec: Recommendation, progress: number) => {
    setRecs((prev) =>
      (prev ?? []).map((r) =>
        r.id === rec.id
          ? { ...r, progress, status: progress >= 100 ? 'completed' : 'in_progress' }
          : r,
      ),
    );
    setError(null);
    try {
      const adapter = new SupabaseMockIgotAdapter();
      await adapter.updateProgress(rec.course_id, progress);
    } catch (err) {
      // The slider moved optimistically; roll it back when nothing was saved.
      setRecs((prev) => (prev ?? []).map((r) => (r.id === rec.id ? rec : r)));
      setError(errorMessage(err, 'Progress update failed'));
    }
  };

  const gapCount = gapsFromMastery(rows, GAP_THRESHOLD).length;

  return (
    <div className="space-y-6">
      <header className="border-b border-gray-700 pb-4">
        <h2 className="text-3xl font-bold text-blue-400">iGOT Karmayogi Training</h2>
        <p className="text-gray-400 mt-1">
          {gapCount > 0
            ? `Personalized from your ${gapCount} competency gap${gapCount > 1 ? 's' : ''} — ranked by urgency.`
            : 'Recommendations update automatically as your mastery changes.'}
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {warning && (
        <p className="text-sm text-amber-200 bg-amber-900/25 border border-amber-700/60 rounded-lg px-4 py-3">
          {warning}
        </p>
      )}
      {!recs && !error && <p className="text-gray-400">Matching courses to your gaps…</p>}

      {recs && recs.length === 0 && (
        <div className="glass rounded-lg p-6 text-gray-400 text-sm">
          No gap-driven recommendations yet — take a quiz first, or browse the seeded catalog on
          the Materials page once courses are added.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(recs ?? []).map((rec) => (
          <div
            key={rec.id}
            className="glass rounded-lg p-5 flex flex-col"
          >
            <div className="flex justify-between items-start gap-2">
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase border ${
                  STATUS_STYLES[rec.status]
                }`}
              >
                {rec.status.replace('_', ' ')}
              </span>
              <span className="text-xs text-gray-500">{rec.course?.duration_hrs ?? '—'}h</span>
            </div>

            <h3 className="font-semibold text-white mt-3 leading-snug">{rec.course?.title}</h3>
            <p className="text-xs text-gray-500 mt-1">{rec.course?.provider}</p>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {(rec.course?.competency_tags ?? []).map((t) => (
                <span key={t} className="bg-gray-700 text-gray-300 text-[11px] px-2 py-0.5 rounded">
                  {COMPETENCY_SHORT[t as keyof typeof COMPETENCY_SHORT] ?? t}
                </span>
              ))}
            </div>

            {rec.reason && <p className="text-xs text-blue-300 mt-3">💡 {rec.reason}</p>}

            <div className="mt-auto pt-4">
              {rec.status === 'recommended' ? (
                <button
                  onClick={() => void enroll(rec)}
                  disabled={busyId === rec.id}
                  className="w-full btn-gradient disabled:opacity-50 text-white text-sm py-2 rounded"
                >
                  {busyId === rec.id ? 'Enrolling…' : 'Enroll on iGOT'}
                </button>
              ) : rec.status === 'completed' ? (
                <p className="text-center text-sm text-green-400">✓ Course completed</p>
              ) : (
                <label className="block text-xs text-gray-400">
                  Progress: {rec.progress}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={rec.progress}
                    onChange={(e) => void setProgress(rec, Number(e.target.value))}
                    className="w-full mt-1 accent-blue-500"
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        Demo runs on a seeded mock catalog behind the igotAdapter interface — the real Karmayogi
        API is a drop-in swap (see src/lib/igot/adapter.ts).
      </p>
    </div>
  );
}
