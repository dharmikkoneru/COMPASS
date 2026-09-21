import { useCallback, useEffect, useState } from 'react';
import { buildDirectory, type DirectoryRow, type MasteryAgg } from '../lib/adminUsers';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../lib/types';

/**
 * Admin user directory: every profile record plus per-officer assessment
 * aggregates. Requires the admin RLS read from migration 0011 — the
 * migration matters because before 0011 `profiles` was readable by any
 * authenticated session, which is exactly what 0011 narrows.
 *
 * Role changes ride on the profiles_update_admin policy from 0001; the UI
 * blocks changing your own role so an admin cannot lock themselves out.
 */
export function useAllProfiles(enabled: boolean) {
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [rawLoading, setRawLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const loading = !enabled ? false : rawLoading;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      // Two explicit reads rather than a PostgREST embed, matching the rest of
      // the app: an embed needs the FK visible in the schema cache or it 400s.
      const { data: profiles, error: profileErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, department, designation, role, created_at')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (profileErr) {
        setError(errorMessage(profileErr, 'Failed to load the user directory'));
        setRawLoading(false);
        return;
      }

      const { data: mastery, error: masteryErr } = await supabase
        .from('competency_mastery')
        .select('user_id, mastery, attempts');
      if (cancelled) return;
      if (masteryErr) {
        setError(errorMessage(masteryErr, 'Failed to load assessment summaries'));
        setRawLoading(false);
        return;
      }

      setRows(buildDirectory((profiles ?? []) as Profile[], (mastery ?? []) as MasteryAgg[]));
      setError(null);
      setRawLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, token]);

  const refresh = useCallback(() => {
    setRawLoading(true);
    setToken((n) => n + 1);
  }, []);

  /** Promote/demote another account. Throws so the caller can surface it. */
  const setRole = useCallback(async (id: string, role: UserRole) => {
    const { error: err } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (err) throw new Error(errorMessage(err, 'Could not update the role'));
    setToken((n) => n + 1);
  }, []);

  return { rows, loading, error, refresh, setRole };
}
