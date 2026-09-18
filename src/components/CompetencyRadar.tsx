import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { COMPETENCIES, COMPETENCY_SHORT, GAP_THRESHOLD, type Competency } from '../lib/competencies';
import type { CompetencyMastery } from '../lib/types';

export default function CompetencyRadar({ rows }: { rows: CompetencyMastery[] }) {
  const map = new Map(rows.map((r) => [r.competency_tag, Number(r.mastery)]));
  const data = COMPETENCIES.map((c: Competency) => ({
    competency: COMPETENCY_SHORT[c],
    mastery: Math.round(map.get(c) ?? 0),
    threshold: GAP_THRESHOLD,
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="rgba(148,163,255,0.18)" />
          <PolarAngleAxis dataKey="competency" tick={{ fill: '#c6c6e0', fontSize: 11 }} />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fill: '#6f6f99', fontSize: 10 }}
            stroke="rgba(148,163,255,0.18)"
          />
          <Radar
            name="Mastery"
            dataKey="mastery"
            stroke="#22d3ee"
            fill="#8b5cf6"
            fillOpacity={0.4}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(22, 22, 46, 0.95)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#e0e0f0' }}
            itemStyle={{ color: '#67e8f9' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
