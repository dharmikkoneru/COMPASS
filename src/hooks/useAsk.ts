import { useCallback, useState } from 'react';
import { invokeAi } from '../lib/ai';
import { functionErrorMessage } from '../lib/errors';

export interface AskSource {
  materialTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  model: string;
}

/**
 * Ask-your-material state machine. One question in flight at a time;
 * the answer and its cited sources persist until replaced, so the
 * officer can scroll back over them while reading the material.
 */
export function useAsk() {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const ask = useCallback(async (question: string, materialId?: string): Promise<boolean> => {
    const q = question.trim();
    if (!q || asking) return false;
    setAsking(true);
    setError(null);
    setLastQuestion(q);
    try {
      const data = await invokeAi<AskResult>('ask-material', {
        question: q,
        materialId: materialId ?? undefined,
      });
      setResult(data);
      return true;
    } catch (err) {
      // The edge function explains its own failure in the response body.
      setError(await functionErrorMessage(err, 'Could not answer that question'));
      return false;
    } finally {
      setAsking(false);
    }
  }, [asking]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
    setLastQuestion(null);
  }, []);

  return { asking, error, result, lastQuestion, ask, clear };
}
