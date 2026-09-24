import { Link } from 'react-router-dom';
import { useCompetencyProfile } from '../hooks/useCompetencyProfile';
import { COMPETENCY_SHORT, GAP_THRESHOLD, displayMastery } from '../lib/competencies';
import { diagnose } from '../lib/gapEngine';

export default function Training() {
  const { rows, loading } = useCompetencyProfile();
  const { gaps, strengths } = diagnose(rows);

  return (
    <div className="space-y-6">
      <header className="border-b border-gray-700 pb-4">
        <h2 className="text-3xl font-bold text-blue-400">AI Training Hub</h2>
        <p className="text-gray-400 mt-1">
          Assess → diagnose → train: the loop that closes your competency gaps.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-6 rounded-lg">
          <div className="text-2xl mb-2">1️⃣</div>
          <h3 className="font-semibold text-white">Assess</h3>
          <p className="text-sm text-gray-400 mt-1">
            Upload MoSPI training material and let Gemini generate competency-tagged MCQs in
            seconds.
          </p>
          <Link
            to="/materials"
            className="inline-block mt-4 btn-gradient text-white text-sm px-4 py-2 rounded"
          >
            Go to Materials
          </Link>
        </div>

        <div className="glass p-6 rounded-lg">
          <div className="text-2xl mb-2">2️⃣</div>
          <h3 className="font-semibold text-white">Diagnose</h3>
          <p className="text-sm text-gray-400 mt-1">
            Every attempt updates your mastery profile with an explainable EMA model — see your
            radar, gaps and strengths.
          </p>
          <Link
            to="/"
            className="inline-block mt-4 border border-gray-600 hover:border-gray-400 text-gray-200 text-sm px-4 py-2 rounded transition"
          >
            View Dashboard
          </Link>
        </div>

        <div className="glass p-6 rounded-lg">
          <div className="text-2xl mb-2">3️⃣</div>
          <h3 className="font-semibold text-white">Train</h3>
          <p className="text-sm text-gray-400 mt-1">
            Gap-ranked iGOT Karmayogi courses with one-click enrollment and progress sync.
          </p>
          <Link
            to="/recommendations"
            className="inline-block mt-4 btn-gradient text-white text-sm px-4 py-2 rounded"
          >
            See Recommendations
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass p-6 rounded-lg">
          <h3 className="font-semibold text-white mb-3">Current focus areas</h3>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : gaps.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No open gaps right now — keep the streak going with new material.
            </p>
          ) : (
            <ul className="space-y-2">
              {gaps.slice(0, 4).map((g) => (
                <li key={g.competency} className="flex justify-between items-center text-sm">
                  <span className="text-gray-200">{g.competency}</span>
                  <span className="text-red-400 font-medium">{displayMastery(g.mastery)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass p-6 rounded-lg">
          <h3 className="font-semibold text-white mb-3">Strengths to leverage</h3>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : strengths.length === 0 ? (
            <p className="text-gray-500 text-sm">Complete more quizzes to surface strengths.</p>
          ) : (
            <ul className="space-y-2">
              {strengths.slice(0, 4).map((s) => (
                <li key={s.competency} className="flex justify-between items-center text-sm">
                  <span className="text-gray-200">{COMPETENCY_SHORT[s.competency]}</span>
                  <span className="text-green-400 font-medium">{displayMastery(s.mastery)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600">
        Gap threshold: {GAP_THRESHOLD}% mastery. Mastery updates use a 60/40 EMA blend of prior
        mastery and the score of the attempt you just took.
      </p>
    </div>
  );
}
