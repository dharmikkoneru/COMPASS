import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QuizRunner from '../components/QuizRunner';
import { supabase } from '../lib/supabase';
import type { Question, Quiz } from '../lib/types';

export default function Quiz() {
  const { quizId } = useParams<{ quizId: string }>();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;

    (async () => {
      const [{ data: q, error: qErr }, { data: qs, error: qsErr }] = await Promise.all([
        supabase.from('quizzes').select('*').eq('id', quizId).maybeSingle(),
        supabase.from('questions').select('*').eq('quiz_id', quizId).order('idx'),
      ]);
      if (cancelled) return;
      if (qErr || qsErr) {
        setError(qErr?.message ?? qsErr?.message ?? 'Failed to load quiz');
        setQuestions([]);
        return;
      }
      if (!q) {
        setError('Quiz not found (or not shared with you).');
        setQuestions([]);
        return;
      }
      setQuiz(q as Quiz);
      setQuestions((qs ?? []) as Question[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [quizId]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <p className="text-red-400">{error}</p>
        <Link to="/materials" className="text-blue-400 hover:underline">
          ← Back to materials
        </Link>
      </div>
    );
  }
  if (!quiz || !questions) {
    return <p className="text-gray-400 py-16 text-center">Loading quiz…</p>;
  }
  if (questions.length === 0) {
    return <p className="text-gray-400 py-16 text-center">This quiz has no questions.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h2 className="text-2xl font-bold text-white">{quiz.title}</h2>
        <p className="text-gray-500 text-sm mt-1 capitalize">{quiz.difficulty} difficulty</p>
      </header>
      <QuizRunner quiz={quiz} questions={questions} />
    </div>
  );
}
