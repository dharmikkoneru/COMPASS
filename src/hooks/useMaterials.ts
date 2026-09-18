import { useCallback, useEffect, useState } from 'react';
import { errorMessage, functionErrorMessage } from '../lib/errors';
import { countQuestionsByQuiz, withStoredCounts } from '../lib/quizCounts';
import { supabase } from '../lib/supabase';
import type { Material, Quiz } from '../lib/types';

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

interface MaterialsSnapshot {
  materials: Material[];
  quizzesByMaterial: Record<string, Quiz[]>;
}

/** One round-trip pair: materials, then their quizzes grouped by material id. */
async function fetchSnapshot(): Promise<MaterialsSnapshot> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const materials = (data ?? []) as Material[];
  const quizzesByMaterial: Record<string, Quiz[]> = {};
  if (materials.length === 0) return { materials, quizzesByMaterial };

  const { data: qz, error: qerr } = await supabase
    .from('quizzes')
    .select('*')
    .order('created_at', { ascending: false });
  if (!qerr && qz) {
    // Count the questions each quiz really holds, rather than trusting the
    // question_count the edge function wrote before inserting them. If that
    // read fails, leave the counts unset (falling back to the claimed number)
    // rather than reporting every quiz as empty.
    const { data: questionRows, error: questionErr } = await supabase
      .from('questions')
      .select('quiz_id');
    const rows =
      questionErr || !questionRows ? null : withStoredCounts(
        qz as Quiz[],
        countQuestionsByQuiz(questionRows as Array<{ quiz_id: string }>),
      );

    for (const q of rows ?? (qz as Quiz[])) {
      quizzesByMaterial[q.material_id] = [
        ...(quizzesByMaterial[q.material_id] ?? []),
        q,
      ];
    }
  }
  return { materials, quizzesByMaterial };
}

export function useMaterials() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [quizzesByMaterial, setQuizzesByMaterial] = useState<Record<string, Quiz[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await fetchSnapshot();
        if (cancelled) return;
        setMaterials(snap.materials);
        setQuizzesByMaterial(snap.quizzesByMaterial);
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load materials'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Manual re-fetch, e.g. after an upload or quiz-generation round trip. */
  const refresh = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setMaterials(snap.materials);
      setQuizzesByMaterial(snap.quizzesByMaterial);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load materials'));
    } finally {
      setLoading(false);
    }
  }, []);

  const addMaterial = useCallback((m: Material) => {
    setMaterials((prev) => [m, ...prev]);
  }, []);

  const createQuiz = useCallback(
    async (material: Material, difficulty: QuizDifficulty, count: number): Promise<Quiz | null> => {
      setGenerating(material.id);
      setError(null);
      try {
        const { data, error } = await supabase.functions.invoke('generate-quiz', {
          body: { materialId: material.id, difficulty, count },
        });
        if (error) throw error;
        const quiz = data as Quiz;
        setQuizzesByMaterial((prev) => ({
          ...prev,
          [material.id]: [quiz, ...(prev[material.id] ?? [])],
        }));
        return quiz;
      } catch (err) {
        // The edge function explains its own failure in the response body.
        setError(await functionErrorMessage(err, 'Quiz generation failed'));
        return null;
      } finally {
        setGenerating(null);
      }
    },
    [],
  );

  const deleteMaterial = useCallback(async (id: string) => {
    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) {
      setError(errorMessage(error, 'Failed to delete the material'));
      return;
    }
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return {
    materials,
    quizzesByMaterial,
    loading,
    error,
    generating,
    refresh,
    addMaterial,
    createQuiz,
    deleteMaterial,
  };
}
