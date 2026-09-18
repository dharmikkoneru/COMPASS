import { Link, useLocation } from 'react-router-dom';

/** Catch-all for unknown routes — without it an unmatched URL rendered an empty shell. */
export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="max-w-xl mx-auto text-center py-24 space-y-4">
      <p className="text-6xl font-bold text-gradient-brand">404</p>
      <h2 className="text-2xl font-bold text-white">No such page</h2>
      <p className="text-gray-400 text-sm">
        <code className="text-gray-300">{pathname}</code> isn't part of the platform. The assess →
        diagnose → train loop starts on the dashboard.
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Link
          to="/"
          className="btn-gradient text-white px-4 py-2 rounded text-sm"
        >
          Go to dashboard
        </Link>
        <Link
          to="/materials"
          className="border border-gray-600 hover:border-gray-400 text-gray-200 px-4 py-2 rounded text-sm transition"
        >
          Upload learning material
        </Link>
      </div>
    </div>
  );
}
