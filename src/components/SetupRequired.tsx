import { COMPETENCIES } from '../lib/competencies';

export default function SetupRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-2xl w-full glass border border-amber-700/50 rounded-lg p-8 shadow-md space-y-4">
        <h1 className="text-2xl font-bold text-amber-400">⚙️ One-time setup required</h1>
        <p className="text-gray-300">
          The COMPASS platform is built, but it needs a Supabase project to run. This takes about
          10 minutes — the full walkthrough is in <code className="text-blue-300">SUPABASE_SETUP.md</code>.
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-400">
          <li>
            Create a free project at{' '}
            <a
              href="https://supabase.com"
              className="text-blue-400 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              supabase.com
            </a>
          </li>
          <li>
            Run every file in{' '}
            <code className="text-blue-300">supabase/migrations/</code> in order (0001 → 0003),
            then <code className="text-blue-300">supabase/seed.sql</code> in the SQL editor
          </li>
          <li>
            <code className="text-blue-300">cp .env.example .env</code> and fill in your project
            URL + anon key
          </li>
          <li>
            Deploy <code className="text-blue-300">supabase/functions/generate-quiz</code> and set{' '}
            <code className="text-blue-300">GEMINI_API_KEY</code> as a function secret
          </li>
          <li>Restart the dev server — signup, uploads, quizzes and recommendations go live</li>
        </ol>
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
          <p className="font-semibold text-gray-400 mb-1">What you're switching on:</p>
          <p>
            8-competency gap diagnosis ({COMPETENCIES.slice(0, 3).join(', ')}…) · Gemini
            MCQ generation from uploaded PDFs · EMA mastery engine · iGOT Karmayogi mock
            catalog with real-API-ready adapter · org heatmap for admins
          </p>
        </div>
      </div>
    </div>
  );
}
