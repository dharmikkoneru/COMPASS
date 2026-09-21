import { useForecast } from '../hooks/useForecast';
import {
  SCENARIO_LEVEL,
  forecastLine,
  type ForecastVerdict,
} from '../lib/forecast';
import { COMPETENCY_SHORT, GAP_THRESHOLD } from '../lib/competencies';
import type { CompetencyMastery } from '../lib/types';

const VERDICT_STYLE: Record<ForecastVerdict, { chip: string; label: string }> = {
  on_track: {
    chip: 'bg-green-900/40 border-green-600 text-green-300',
    label: 'On track',
  },
  catching_up: {
    chip: 'bg-blue-900/40 border-blue-600 text-blue-300',
    label: 'Catching up',
  },
  plateau: {
    chip: 'bg-red-900/40 border-red-700 text-red-300',
    label: 'Plateau',
  },
  not_assessed: {
    chip: 'bg-gray-800 border-gray-600 text-gray-400',
    label: 'Not assessed',
  },
};

interface Props {
  rows: CompetencyMastery[];
  readiness: number;
}

/**
 * Skill Trend Forecast — where each competency is heading and what it takes
 * to close the remaining gaps. Projections are deterministic EMA algebra
 * (see src/lib/forecast.ts), so every number on this panel is explainable.
 */
export default function ForecastPanel({ rows, readiness }: Props) {
  const { forecast, loading } = useForecast(rows);
  const { items, projectedReadiness, cadence } = forecast;
  const tracked = items.filter((i) => i.verdict !== 'not_assessed');

  const delta = projectedReadiness - readiness;

  return (
    <div className="glass p-6 rounded-lg">
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <div>
          <h3 className="font-semibold text-white">Skill Trend Forecast</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Trajectory per competency, projected from your EMA mastery and quiz
            cadence — deterministic, no black box.
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-400">
            Now <span className="font-bold text-white">{readiness}%</span>
            <span className="mx-1 text-gray-600">→</span>
            ~4 weeks{' '}
            <span
              className={`font-bold ${
                delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white'
              }`}
            >
              {delta > 0 ? '+' : ''}
              {projectedReadiness}%
            </span>
          </p>
          <p className="text-[11px] text-gray-500">
            {cadence !== null
              ? `at your pace of ~${cadence.toFixed(1)} quiz${cadence >= 2 ? 'zes' : ''}/week`
              : 'assume ~2 quizzes over 4 weeks'}
          </p>
        </div>
      </div>

      {loading && <p className="text-gray-500 text-sm mt-4">Estimating your quiz pace…</p>}

      {!loading && tracked.length === 0 && (
        <p className="text-gray-500 text-sm mt-4">
          No forecast yet — take a quiz and this panel projects how fast each
          competency reaches {GAP_THRESHOLD}%.
        </p>
      )}

      {!loading && tracked.length > 0 && (
        <ul className="mt-4 space-y-2">
          {tracked.map((item) => {
            const style = VERDICT_STYLE[item.verdict];
            return (
              <li
                key={item.competency}
                className="border border-white/10 rounded px-3 py-2.5 bg-white/[0.03]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">
                    {COMPETENCY_SHORT[item.competency] ?? item.competency}
                  </span>
                  <span className="text-xs text-gray-500">{Math.round(item.mastery)}%</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.chip}`}
                  >
                    {style.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {forecastLine(item)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {tracked.some((i) => i.verdict === 'plateau') && (
        <p className="text-[11px] text-gray-500 mt-3 border-t border-white/10 pt-2">
          How to read a plateau: mastery is a rolling average, so a gap stays
          open while quiz scores stay below {GAP_THRESHOLD}%. Sustaining{' '}
          {SCENARIO_LEVEL}% per quiz closes it — the forecast states how many
          quizzes that takes.
        </p>
      )}
    </div>
  );
}
