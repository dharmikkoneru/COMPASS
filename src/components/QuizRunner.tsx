import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPETENCY_SHORT, GAP_THRESHOLD, displayMastery } from '../lib/competencies';
import { overallReadiness } from '../lib/gapEngine';
import { errorMessage } from '../lib/errors';
import type { AttemptResult, CompetencyMastery, MasteryDelta, Question, Quiz } from '../lib/types';

interface TagTally {
  tag: string;
  correct: number;
  total: number;
}

interface AttemptSummary {
  score: number;
  perTag: TagTally[];
  /** Per-competency movement, from the rows apply_attempt hands back. */
  deltas: MasteryDelta[];
  /** Null when the pre-submission snapshot could not be read — see submit(). */
  readinessBefore: number | null;
  readinessAfter: number | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * `33% → 60% ▲` for one competency.
 *
 * The RPC returns the updated mastery rows and this screen used to discard them
 * (`void data;`), so the officer was told "mastery updated" without being shown
 * a single number. The move is the whole point of the review screen — and of the
 * demo, where the radar visibly shifting is the proof the gap engine works.
 */
function MasteryMove({ delta }: { delta: MasteryDelta }) {
  const before = displayMastery(delta.before);
  const after = displayMastery(delta.after);
  const tone =
    after > before
      ? 'text-green-300'
      : after < before
        ? 'text-red-300'
        : 'text-gray-400';
  const arrow = after > before ? '▲' : after < before ? '▼' : '—';
  return (
    <span
      className={`font-medium whitespace-nowrap ${tone}`}
      title={`Mastery was ${delta.before.toFixed(1)}%, now ${delta.after.toFixed(1)}%`}
    >
      {before}% → {after}% {arrow}
    </span>
  );
}

export default function QuizRunner({
  quiz,
  questions,
}: {
  quiz: Quiz;
  questions: Question[];
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptSummary | null>(null);

  const total = questions.length;
  const current = questions[idx];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === total;
  const perTag: TagTally[] = result?.perTag ?? [];

  const choose = (optionIdx: number) => {
    setAnswers((prev) => ({ ...prev, [current.idx]: optionIdx }));
    if (idx < total - 1) setIdx(idx + 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let score = 0;
      const tallies = new Map<string, TagTally>();
      for (const q of questions) {
        const chosen = answers[q.idx];
        const ok = chosen === q.correct_idx;
        if (ok) score += 1;
        const t = tallies.get(q.competency_tag as string) ?? {
          tag: q.competency_tag as string,
          correct: 0,
          total: 0,
        };
        t.total += 1;
        if (ok) t.correct += 1;
        tallies.set(t.tag, t);
      }

      // Snapshot the profile *before* the RPC rewrites it: the rows it returns
      // are the post-attempt values, and "33% → 60%" needs both halves.
      const { data: snapshotRows } = await supabase
        .from('competency_mastery')
        .select('competency_tag, mastery, attempts, correct, total');
      const snapshot = (snapshotRows ?? null) as CompetencyMastery[] | null;

      const { data, error } = await supabase.rpc('apply_attempt', {
        p_quiz_id: quiz.id,
        p_answers: answers,
        p_score: score,
        p_total: total,
      });
      if (error) throw error;

      const updated = (data ?? []) as AttemptResult[];
      const before = new Map(
        (snapshot ?? []).map((r) => [r.competency_tag, Number(r.mastery)]),
      );
      const touched = new Set(updated.map((r) => r.competency_tag));

      setResult({
        score,
        perTag: [...tallies.values()],
        deltas: updated.map((r) => ({
          competency_tag: r.competency_tag,
          before: before.get(r.competency_tag) ?? 0,
          after: Number(r.mastery),
        })),
        // Readiness is the mean across the whole taxonomy, so swapping the
        // touched rows into the snapshot yields the figure the dashboard shows.
        // A failed snapshot read means no honest delta — better to omit the
        // line than to claim "0% → 62%".
        readinessBefore: snapshot ? overallReadiness(snapshot) : null,
        readinessAfter: snapshot
          ? overallReadiness([
              ...snapshot.filter((r) => !touched.has(r.competency_tag)),
              ...updated,
            ])
          : null,
      });
    } catch (err) {
      setError(errorMessage(err, 'Submission failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setAnswers({});
    setIdx(0);
    setResult(null);
    setError(null);
  };

  if (result) {
    const pct = Math.round((result.score / total) * 100);
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="glass rounded-lg p-8 text-center">
          <p className="text-gray-400 uppercase tracking-wider text-sm">Your score</p>
          <p
            className={`text-6xl font-bold mt-2 ${
              pct >= GAP_THRESHOLD ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {pct}%
          </p>
          <p className="text-gray-400 mt-2">
            {result.score} of {total} correct — mastery updated across your competency profile.
          </p>
          {result.readinessBefore !== null && result.readinessAfter !== null && (
            <p className="text-sm text-gray-300 mt-3">
              Overall readiness <span className="text-gray-400">{result.readinessBefore}%</span>{' '}
              →{' '}
              <span
                className={
                  result.readinessAfter >= result.readinessBefore
                    ? 'text-green-400 font-semibold'
                    : 'text-amber-400 font-semibold'
                }
              >
                {result.readinessAfter}%
              </span>
            </p>
          )}
        </div>

        <div className="glass rounded-lg p-6">
          <h3 className="font-semibold text-white">Competency breakdown</h3>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Mastery is a 60/40 blend of what you already knew and how you did on this attempt.
          </p>
          <ul className="space-y-2">
            {perTag.map((t) => {
              const ratio = Math.round((t.correct / t.total) * 100);
              const delta = result.deltas.find((d) => d.competency_tag === t.tag);
              return (
                <li
                  key={t.tag}
                  className="flex items-center justify-between gap-3 bg-gray-700/50 rounded px-3 py-2"
                >
                  <span className="text-gray-200 text-sm">
                    {COMPETENCY_SHORT[t.tag as keyof typeof COMPETENCY_SHORT] ?? t.tag}
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    {delta && <MasteryMove delta={delta} />}
                    <span
                      className={
                        ratio >= GAP_THRESHOLD ? 'text-green-400 font-medium' : 'text-red-400 font-medium'
                      }
                    >
                      {t.correct}/{t.total}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The AI writes an explanation for every question, and until now nothing
            ever read it: the justification for a wrong answer was captured at
            generation time and thrown away at the results screen. */}
        <div className="glass rounded-lg p-6">
          <h3 className="font-semibold text-white mb-3">Review &amp; explanations</h3>
          <ul className="space-y-4">
            {questions.map((q) => {
              const chosen = answers[q.idx];
              const correct = chosen === q.correct_idx;
              return (
                <li
                  key={q.id}
                  className="border-t border-gray-700 pt-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-xs font-bold mt-0.5 ${correct ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {correct ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0 break-words">
                      <p className="text-sm text-gray-100 leading-relaxed">
                        {q.idx + 1}. {q.text}
                      </p>
                      <p className="text-xs mt-1.5 text-gray-400">
                        Your answer:{' '}
                        <span className={correct ? 'text-green-300' : 'text-red-300'}>
                          {chosen === undefined
                            ? 'none'
                            : `${LETTERS[chosen]}) ${q.options[chosen]}`}
                        </span>
                      </p>
                      {!correct && (
                        <p className="text-xs mt-1 text-gray-400">
                          Correct:{' '}
                          <span className="text-green-300">
                            {LETTERS[q.correct_idx]}) {q.options[q.correct_idx]}
                          </span>
                        </p>
                      )}
                      {q.explanation && (
                        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex gap-3">
          <Link
            to="/"
            className="flex-1 text-center btn-gradient text-white px-4 py-2 rounded"
          >
            View updated dashboard →
          </Link>
          <Link
            to="/recommendations"
            className="flex-1 text-center border border-gray-600 hover:border-gray-400 text-gray-200 px-4 py-2 rounded transition"
          >
            See iGOT recommendations
          </Link>
        </div>

        <div className="text-center">
          <button
            onClick={retake}
            className="text-sm text-gray-400 hover:text-white underline transition"
          >
            Retake this quiz
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center text-sm text-gray-400">
        <span>
          Question {idx + 1} of {total}
        </span>
        <span>{answeredCount} answered</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${(answeredCount / total) * 100}%` }}
        />
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-md">
        <div className="mb-4 flex gap-2">
          <span className="bg-blue-900 text-blue-300 text-xs font-bold px-2 py-1 rounded uppercase">
            {COMPETENCY_SHORT[current.competency_tag as keyof typeof COMPETENCY_SHORT] ??
              current.competency_tag}
          </span>
          <span className="bg-gray-700 text-gray-300 text-xs font-bold px-2 py-1 rounded uppercase">
            {current.difficulty}
          </span>
        </div>

        <p className="text-gray-100 text-lg leading-relaxed mb-6">{current.text}</p>

        <div className="space-y-3">
          {current.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={submitting}
              className={`w-full text-left p-4 rounded border transition ${
                answers[current.idx] === i
                  ? 'bg-blue-900/60 border-blue-500'
                  : 'bg-gray-700 hover:bg-gray-600 border-gray-600'
              }`}
            >
              <span className="font-bold text-blue-300 mr-2">{LETTERS[i]})</span>
              <span className="text-gray-100">{opt}</span>
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400 mt-4">{error}</p>}

        <div className="mt-6 flex justify-between items-center">
          <button
            onClick={() => setIdx(Math.max(0, idx - 1))}
            disabled={idx === 0 || submitting}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-30 transition"
          >
            ← Previous
          </button>
          {idx === total - 1 && (
            <button
              onClick={() => void submit()}
              disabled={!allAnswered || submitting}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-6 py-2 rounded font-medium transition"
            >
              {submitting ? 'Submitting…' : 'Submit & update mastery'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
