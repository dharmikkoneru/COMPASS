// ═══════════════════════════════════════════════════════════════
// COMPASS — embed-material Edge Function (Supabase / Deno)
//
// Chunks a material's raw_text and stores Gemini text-embedding-004
// vectors in public.material_chunks. Called by the client right after
// an upload, and re-callable any time to re-index a material.
//
// Deploy:
//   supabase functions deploy embed-material
//   (uses the same GEMINI_API_KEY secret as generate-quiz)
//
// Contract (POST, JSON):
//   req : { materialId: string }
//   res : { materialId, chunks: number, dims: 768 }
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  embedTexts,
  errorText,
  fetchWithin,
  left,
  MAX_REQUEST_MS,
  MIN_ATTEMPT_MS,
  newBudget,
} from '../_shared/gemini.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ~700 chars keeps one chunk on one topic; ~120-char overlap stops a
// sentence that straddles the boundary from vanishing from both sides.
const CHUNK_CHARS = 700;
const OVERLAP_CHARS = 120;
/** One embedding round trip per batch — keeps request count low. */
const EMBED_BATCH = 32;

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + CHUNK_CHARS));
    start += CHUNK_CHARS - OVERLAP_CHARS;
  }
  return chunks;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const budget = newBudget();
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return json({ error: 'Not authenticated' }, 401);

    const { materialId } = await req.json();
    if (!materialId) return json({ error: 'materialId is required' }, 400);

    // RLS ensures the caller only sees their own material.
    const { data: material, error: mErr } = await supabase
      .from('materials')
      .select('id, raw_text')
      .eq('id', materialId)
      .single();
    if (mErr || !material) return json({ error: 'Material not found' }, 404);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'GEMINI_API_KEY secret is not set' }, 500);

    const chunks = chunkText(material.raw_text);
    if (chunks.length === 0) {
      return json({ error: 'Material has no text content to index' }, 400);
    }

    // Delete-then-insert per material: idempotent re-index, no upsert
    // bookkeeping on (material_id, chunk_index). On failure nothing is
    // half-replaced — the old index stays intact and the error surfaces.
    const { error: delErr } = await supabase
      .from('material_chunks')
      .delete()
      .eq('material_id', material.id);
    if (delErr) {
      return json(
        { error: `Could not clear old chunks (is migration 0007 applied?): ${delErr.message}` },
        400,
      );
    }

    let done = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      if (left(budget) < MIN_ATTEMPT_MS) {
        return json(
          {
            error:
              `Indexing ran out of its time budget after ${done}/${chunks.length} chunks. ` +
              'The material was left unindexed — press Re-index again (it resumes from scratch safely).',
          },
          504,
        );
      }

      const vectors = await embedTexts(apiKey, slice, budget);

      const rows = slice.map((content, j) => ({
        material_id: material.id,
        user_id: auth.user.id,
        chunk_index: i + j,
        content,
        // pgvector accepts a plain array literal for a vector column.
        embedding: JSON.stringify(vectors[j]),
      }));

      const { error: insErr } = await supabase.from('material_chunks').insert(rows);
      if (insErr) {
        return json(
          {
            error:
              `Storing chunks failed (is migration 0007 applied?): ${insErr.message} ` +
              'Nothing was half-written — the previous index for this material is intact.',
          },
          400,
        );
      }
      done += slice.length;
    }

    // Best-effort: stamp the material as indexed so the UI can badge it.
    try {
      await fetchWithin(
        `${Deno.env.get('SUPABASE_URL')}/rest/v1/materials?id=eq.${material.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: authHeader,
            apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ status: 'ready' }),
        },
        Math.min(left(budget), MAX_REQUEST_MS),
      );
    } catch {
      // Non-fatal: the chunks are in; the badge is cosmetic.
    }

    return json({ materialId: material.id, chunks: done, dims: 768 });
  } catch (err) {
    return json({ error: errorText(err) }, 500);
  }
});
