import type { Competency } from './competencies';

export type UserRole = 'officer' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  department: string | null;
  designation: string | null;
  role: UserRole;
  created_at: string;
}

export interface Material {
  id: string;
  user_id: string;
  title: string;
  source_type: 'pdf' | 'text';
  raw_text: string;
  status: 'processing' | 'ready' | 'error';
  created_at: string;
}

export interface Quiz {
  id: string;
  material_id: string;
  created_by: string;
  title: string;
  difficulty: string;
  question_count: number;
  created_at: string;
  /**
   * Questions actually stored for this quiz, counted client-side by
   * src/lib/quizCounts.ts. `question_count` is written before the questions
   * are, so it overstates the row whenever a generation is interrupted.
   */
  stored_question_count?: number;
}

export interface Question {
  id: string;
  quiz_id: string;
  idx: number;
  text: string;
  options: string[];
  correct_idx: number;
  explanation: string | null;
  competency_tag: Competency | string;
  difficulty: string;
}

export interface CompetencyMastery {
  competency_tag: string;
  mastery: number;
  attempts: number;
  correct: number;
  total: number;
}

export interface IgotCourse {
  id: string;
  external_id: string;
  title: string;
  provider: string;
  duration_hrs: number;
  competency_tags: string[];
  url: string;
  is_mock: boolean;
}

export interface Recommendation {
  id: string;
  user_id: string;
  course_id: string;
  competency_tag: string;
  reason: string | null;
  status: 'recommended' | 'enrolled' | 'in_progress' | 'completed';
  progress: number;
  created_at: string;
  /** Joined client-side by the adapter. */
  course?: IgotCourse;
}

/** A submitted quiz attempt (written by the apply_attempt RPC). */
export interface Attempt {
  id: string;
  quiz_id: string;
  user_id: string;
  /** Question idx → chosen option index, keyed column-wise in jsonb. */
  answers: Record<string, number>;
  score: number;
  total: number;
  status: 'completed' | 'abandoned';
  submitted_at: string;
}

/** Row returned by the apply_attempt RPC. */
export interface AttemptResult {
  competency_tag: string;
  mastery: number;
  attempts: number;
  correct: number;
  total: number;
}

/** Payload produced by the generate-quiz edge function. */
export interface GeneratedQuestion {
  idx: number;
  text: string;
  options: string[];
  correct_idx: number;
  explanation: string;
  competency_tag: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GeneratedQuiz {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questions: GeneratedQuestion[];
}
