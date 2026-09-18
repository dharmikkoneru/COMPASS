import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import type { CompetencyMastery } from '../lib/types';

/** Signed-in user's mastery rows. */
export function useCompetencyProfile() {
  const [rows, setRows] = useState<CompetencyMastery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refresh() to re-run the effect. A `refresh` that only copied the
  // rows it already had looked like a reload but never asked the server again,
  // so a profile stayed stale for as long as the page stayed mounted.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase
        .from('competency_mastery')
        .select('competency_tag, mastery, attempts, correct, total');
      if (cancelled) return;
      if (err) {
        setError(errorMessage(err, 'Failed to load your competency profile'));
      } else {
        setError(null);
        setRows((data ?? []) as CompetencyMastery[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // setLoading happens here rather than inside the effect: setting state
  // synchronously in an effect schedules a second render for no reason.
  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((n) => n + 1);
  }, []);

  return { rows, loading, error, refresh };
}

export interface AdminUserMastery {
  full_name: string;
  department: string | null;
  competency_tag: string;
  mastery: number;
}

/** All users' mastery joined with names — requires the admin RLS read. */
export function useAllMastery(enabled: boolean) {
  const [rows, setRows] = useState<AdminUserMastery[]>([]);
  const [rawLoading, setRawLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loading = !enabled ? false : rawLoading;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      // Two explicit reads rather than one PostgREST embed: embedding
      // profiles needs a foreign key to public.profiles present in the
      // schema cache, and when that is missing the query 400s with
      // "Could not find a relationship…". Joining here cannot fail that way.
      const { data: mastery, error: masteryErr } = await supabase
        .from('competency_mastery')
        .select('user_id, mastery, competency_tag');
      if (cancelled) return;
      if (masteryErr) {
        setError(errorMessage(masteryErr, 'Failed to load org mastery data'));
        setRawLoading(false);
        return;
      }

      const masteryRows = mastery ?? [];
      const userIds = [...new Set(masteryRows.map((r) => r.user_id as string))];
      const officers = new Map<
        string,
        { full_name: string | null; department: string | null }
      >();

      if (userIds.length > 0) {
        const { data: profiles, error: profilesErr } = await supabase
          .from('profiles')
          .select('id, full_name, department')
          .in('id', userIds);
        if (cancelled) return;
        if (profilesErr) {
          setError(errorMessage(profilesErr, 'Failed to load officer profiles'));
          setRawLoading(false);
          return;
        }
        for (const p of profiles ?? []) officers.set(p.id as string, p);
      }

      if (cancelled) return;
      setRows(
        masteryRows.map((r) => {
          const p = officers.get(r.user_id as string);
          return {
            full_name: p?.full_name ?? 'Unknown officer',
            department: p?.department ?? null,
            competency_tag: r.competency_tag as string,
            mastery: Number(r.mastery),
          };
        }),
      );
      setRawLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { rows, loading, error };
}
