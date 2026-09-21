import { useAuth } from '../context/AuthContext';
import { isGuestEmail } from '../lib/guest';

/**
 * Thin banner rendered only inside the shared guest demo session, so every
 * screen a judge sees is honestly labelled as preview data.
 */
export default function DemoBanner() {
  const { session } = useAuth();
  if (!isGuestEmail(session?.user.email)) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-xs text-center py-1.5 px-4">
      Guest preview — seeded demo data. Sign out and create an account to assess yourself.
    </div>
  );
}
