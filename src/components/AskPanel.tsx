import { useState, type FormEvent } from 'react';
import { useAsk } from '../hooks/useAsk';
import type { Material } from '../lib/types';

/**
 * "Ask your material" — RAG panel. The officer asks a question either
 * against one material or across everything they have indexed; the
 * answer arrives grounded in their own documents, with the cited
 * passages and similarity scores shown underneath for verification.
 */
export default function AskPanel({ materials }: { materials: Material[] }) {
  const { asking, error, result, ask, clear } = useAsk();
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<string>('all');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking) return;
    void ask(question, scope === 'all' ? undefined : scope);
  };

  const indexedCount = materials.length;

  return (
    <div className="glass rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Ask your material</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Grounded answers from your own documents — every claim cites its passage.
          </p>
        </div>
        {result && (
          <button
            onClick={clear}
            className="text-xs text-gray-500 hover:text-white transition shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            indexedCount === 0
              ? 'Upload and index a material first, then ask it anything…'
              : 'e.g. What is the rule for treating a non-sampling error in a household survey?'
          }
          rows={2}
          maxLength={500}
          className="w-full rounded-md bg-black/25 border border-white/10 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40 resize-none transition"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="bg-gray-700/60 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 sm:flex-none"
          >
            <option value="all">All materials</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title.length > 40 ? `${m.title.slice(0, 40)}…` : m.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="btn-gradient disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm whitespace-nowrap"
          >
            {asking ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-400 whitespace-pre-line break-words">{error}</p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="rounded-md bg-black/25 border border-white/10 p-4">
            <p className="text-sm text-gray-100 whitespace-pre-line">{result.answer}</p>
            {result.model !== 'none' && (
              <p className="text-[11px] text-gray-600 mt-2">via {result.model}</p>
            )}
          </div>

          {result.sources.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400">Sources</p>
              {result.sources.map((s, i) => (
                <details
                  key={`${s.materialTitle}-${s.chunkIndex}`}
                  className="rounded-md bg-black/20 border border-white/5 px-3 py-2"
                >
                  <summary className="text-xs text-gray-400 cursor-pointer select-none">
                    <span className="text-gray-200">[{i + 1}]</span> {s.materialTitle} · passage{' '}
                    {s.chunkIndex + 1} · {Math.round(s.similarity * 100)}% match
                  </summary>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">{s.content}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
