import { useRef, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { extractPdfText, clampText } from '../lib/pdfText';
import { supabase } from '../lib/supabase';
import type { Material } from '../lib/types';

type Tab = 'pdf' | 'text';

export default function MaterialUploader({ onSaved }: { onSaved: (m: Material) => void }) {
  const [tab, setTab] = useState<Tab>('pdf');
  const [title, setTitle] = useState('');
  const [pasted, setPasted] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveMaterial = async (
    finalTitle: string,
    sourceType: 'pdf' | 'text',
    rawText: string,
  ): Promise<void> => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error('Not signed in');

    const { data, error } = await supabase
      .from('materials')
      .insert({
        user_id: userData.user.id,
        title: finalTitle,
        source_type: sourceType,
        raw_text: clampText(rawText),
        status: 'ready',
      })
      .select()
      .single();
    if (error) throw error;
    onSaved(data as Material);
  };

  const handlePdf = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      setProgress(`Reading “${file.name}”…`);
      const text = await extractPdfText(file, (f) =>
        setProgress(`Extracting text… page ${Math.round(f * 100)}%`),
      );
      if (text.replace(/\s/g, '').length < 50) {
        throw new Error(
          'Could not extract enough text — the PDF may be a scan without a text layer.',
        );
      }
      setProgress('Saving…');
      await saveMaterial(title.trim() || file.name.replace(/\.pdf$/i, ''), 'pdf', text);
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      setProgress(null);
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const handleText = async () => {
    setError(null);
    setBusy(true);
    try {
      if (pasted.replace(/\s/g, '').length < 50) {
        throw new Error('Paste at least a couple of paragraphs of training material.');
      }
      setProgress('Saving…');
      await saveMaterial(title.trim() || 'Pasted material', 'text', pasted);
      setTitle('');
      setPasted('');
      setProgress(null);
    } catch (err) {
      setError(errorMessage(err, 'Save failed'));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-md bg-gray-700 border border-gray-600 px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500';

  return (
    <div className="glass rounded-lg p-6 space-y-4">
      <div className="flex rounded-md overflow-hidden border border-gray-600">
        {(['pdf', 'text'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium transition ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            {t === 'pdf' ? 'Upload PDF' : 'Paste text'}
          </button>
        ))}
      </div>

      <input
        className={input}
        placeholder="Material title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {tab === 'pdf' ? (
        <div className="border border-dashed border-gray-600 rounded-md p-6 text-center">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePdf(f);
            }}
          />
          <p className="text-gray-400 text-sm mb-3">
            Training circulars, manuals, NSO guidelines — text-based PDFs.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="btn-gradient disabled:opacity-50 text-white px-4 py-2 rounded text-sm"
          >
            Choose PDF
          </button>
        </div>
      ) : (
        <>
          <textarea
            className={`${input} min-h-40`}
            placeholder="Paste training material text — field manual excerpts, guidelines, SOPs…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleText()}
            className="w-full btn-gradient disabled:opacity-50 text-white font-medium py-2 rounded-md"
          >
            Save material
          </button>
        </>
      )}

      {progress && <p className="text-sm text-blue-300">{progress}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
