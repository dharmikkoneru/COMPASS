import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AskPanel from '../components/AskPanel';
import MaterialUploader from '../components/MaterialUploader';
import { aiServiceStatus, invokeAi } from '../lib/ai';
import { functionErrorMessage } from '../lib/errors';
import { generationNote } from '../lib/connectivity';
import { useMaterials, type QuizDifficulty } from '../hooks/useMaterials';
import type { Material } from '../lib/types';
import { quizCountLabel } from '../lib/quizCounts';

const COUNTS = [5, 8, 10];

interface GenerationRequest {
  material: Material;
  difficulty: QuizDifficulty;
  count: number;
}

/**
 * Elapsed-time note for a running generation.
 *
 * A cold free-tier API takes about a minute, and a button that reads
 * "Generating…" for that long is indistinguishable from a hang. This counts
 * seconds and, past a normal generation's duration, says why it might be slow.
 * Renders nothing while the wait is short enough to be unremarkable.
 */
function GeneratingNote({ startedAt }: { startedAt: number | null }) {
  // A clock, not a counter: the elapsed time is derived from the start instant
  // at render, so the effect only has to keep the clock ticking and never has
  // to reset state. Before the first tick `now` can predate `startedAt`, which
  // clamps to 0s — correct for a request that has just begun.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null) return null;
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  // Read the transport's status at render rather than subscribing: this
  // component already re-renders every second, so a subscription would only
  // double the renders to learn something that is at most 1s stale.
  const note = generationNote(elapsedSec, aiServiceStatus() === 'waking');
  if (!note) return null;
  return <p className="text-xs text-gray-400 mt-2">{note}</p>;
}

export default function Materials() {
  const {
    materials,
    quizzesByMaterial,
    loading,
    error,
    generating,
    generatingSince,
    createQuiz,
    deleteMaterial,
    addMaterial,
  } = useMaterials();
  const [count, setCount] = useState<Record<string, number>>({});
  const [difficulty, setDifficulty] = useState<Record<string, QuizDifficulty>>({});
  const [indexing, setIndexing] = useState<string | null>(null);
  const [indexNote, setIndexNote] = useState<string | null>(null);
  /** The last generation asked for, so a failure can be retried unchanged. */
  const [lastAttempt, setLastAttempt] = useState<GenerationRequest | null>(null);

  /**
   * Generate, remembering the request so its failure is retryable.
   *
   * The alternative — asking the officer to re-pick the material, difficulty
   * and count after a cold start ate their first attempt — is the kind of small
   * insult that makes a working feature feel broken.
   */
  const generate = async (request: GenerationRequest) => {
    setLastAttempt(request);
    const quiz = await createQuiz(request.material, request.difficulty, request.count);
    if (quiz) setLastAttempt(null);
  };

  // Index (or re-index) a material for the Ask panel: chunks + embeds it
  // via the embed-material function. Idempotent — safe to press again.
  const indexMaterial = async (m: Material) => {
    setIndexing(m.id);
    setIndexNote(null);
    try {
      const data = await invokeAi<{ chunks?: number }>('embed-material', { materialId: m.id });
      setIndexNote(
        `Indexed "${m.title}" — ${data.chunks ?? 0} passages ready for questions.`,
      );
    } catch (err) {
      setIndexNote(await functionErrorMessage(err, 'Indexing failed'));
    } finally {
      setIndexing(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="border-b border-gray-700 pb-4">
        <h2 className="text-3xl font-bold text-blue-400">Learning Materials</h2>
        <p className="text-gray-400 mt-1">
          Upload training material — the AI builds MCQ quizzes from it, tagged by competency.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <MaterialUploader onSaved={addMaterial} />
          <AskPanel materials={materials} />
        </div>

        <div className="space-y-4">
          {indexNote && (
            <p className="text-sm text-cyan-300/90 whitespace-pre-line break-words">{indexNote}</p>
          )}
          {loading && <p className="text-gray-400">Loading materials…</p>}
          {/* whitespace-pre-line: edge-function failures come back as a multi-line diagnosis */}
          {error && (
            <p className="text-sm text-red-400 whitespace-pre-line break-words">
              {error}
              {lastAttempt && (
                <button
                  onClick={() => void generate(lastAttempt)}
                  className="ml-2 text-cyan-300/90 hover:text-cyan-200 underline transition"
                >
                  Try again
                </button>
              )}
            </p>
          )}
          {!loading && materials.length === 0 && (
            <div className="glass rounded-lg p-6 text-gray-400 text-sm">
              No materials yet. Upload a PDF or paste text to generate your first quiz.
            </div>
          )}
          {materials.map((m) => {
            const quizzes = quizzesByMaterial[m.id] ?? [];
            const busy = generating === m.id;
            return (
              <div key={m.id} className="glass rounded-lg p-5">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{m.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {m.source_type.toUpperCase()} · {Math.round(m.raw_text.length / 100) / 10}k chars ·{' '}
                      {new Date(m.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void indexMaterial(m)}
                      disabled={indexing === m.id}
                      className="text-xs text-cyan-300/80 hover:text-cyan-200 transition disabled:opacity-50"
                      title="Chunk + embed this material so the Ask panel can answer questions from it"
                    >
                      {indexing === m.id ? 'Indexing…' : 'Index for Q&A'}
                    </button>
                    <button
                      onClick={() => void deleteMaterial(m.id)}
                      className="text-xs text-gray-500 hover:text-red-400 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select
                    value={count[m.id] ?? 5}
                    onChange={(e) => setCount((prev) => ({ ...prev, [m.id]: Number(e.target.value) }))}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm"
                  >
                    {COUNTS.map((c) => (
                      <option key={c} value={c}>
                        {c} questions
                      </option>
                    ))}
                  </select>
                  <select
                    value={difficulty[m.id] ?? 'medium'}
                    onChange={(e) =>
                      setDifficulty((prev) => ({ ...prev, [m.id]: e.target.value as QuizDifficulty }))
                    }
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void generate({
                        material: m,
                        difficulty: difficulty[m.id] ?? 'medium',
                        count: count[m.id] ?? 5,
                      })
                    }
                    className="btn-gradient disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm"
                  >
                    {busy ? 'Generating…' : 'Generate AI quiz'}
                  </button>
                </div>

                {busy && <GeneratingNote startedAt={generatingSince} />}

                {quizzes.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {quizzes.map((q) => {
                      // Show how many questions are actually stored: a quiz whose
                      // generation died mid-way claims a count it does not have.
                      const count = quizCountLabel(q);
                      return (
                        <li key={q.id}>
                          <Link
                            to={`/quiz/${q.id}`}
                            className="flex justify-between items-center bg-gray-700/50 hover:bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm transition"
                          >
                            <span className="text-gray-200">{q.title}</span>
                            <span
                              className={count.empty ? 'text-amber-400' : 'text-gray-400'}
                              title={
                                count.empty
                                  ? `No questions were stored for this quiz — deleting it and generating again is the fix.`
                                  : undefined
                              }
                            >
                              {count.text}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
