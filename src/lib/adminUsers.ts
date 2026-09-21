// Admin user directory — pure shaping and search helpers, unit-tested in
// src/lib/adminUsers.test.ts.
//
// The directory is exactly what migration 0011 permits an admin to read:
// profile records. Credentials are not filtered out here because they are
// not reachable at all — password hashes live in auth.users, which the
// API never exposes.

import type { Profile, UserRole } from './types';

/** Minimal shape of a competency_mastery row needed for directory stats. */
export interface MasteryAgg {
  user_id: string;
  mastery: number;
  attempts: number;
}

export interface DirectoryRow {
  id: string;
  email: string;
  fullName: string;
  department: string;
  designation: string;
  role: UserRole;
  joined: string;
  /** Sum of recorded quiz attempts across competencies. */
  assessments: number;
  /** Mean mastery over ASSESSED competencies; null when never assessed. */
  readiness: number | null;
}

/**
 * Join profiles with their mastery aggregates.
 *
 * Readiness averages only the competencies actually assessed — averaging
 * unassessed ones in as zeros would report a diligent officer who has taken
 * one quiz as 8% ready, which is worse than useless in a directory.
 */
export function buildDirectory(profiles: Profile[], mastery: MasteryAgg[]): DirectoryRow[] {
  const byUser = new Map<string, MasteryAgg[]>();
  for (const m of mastery) {
    const list = byUser.get(m.user_id);
    if (list) list.push(m);
    else byUser.set(m.user_id, [m]);
  }

  return profiles
    .map((p) => {
      const rows = byUser.get(p.id) ?? [];
      const readiness =
        rows.length === 0
          ? null
          : Math.round(rows.reduce((acc, r) => acc + Number(r.mastery), 0) / rows.length);
      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name?.trim() || p.email,
        department: p.department?.trim() || '—',
        designation: p.designation?.trim() || '—',
        role: p.role,
        joined: p.created_at,
        assessments: rows.reduce((acc, r) => acc + Number(r.attempts), 0),
        readiness,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Case-insensitive search across name, email, department and designation. */
export function filterDirectory(rows: DirectoryRow[], query: string): DirectoryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.fullName, r.email, r.department, r.designation].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}

export interface DirectoryStats {
  total: number;
  admins: number;
  departments: number;
  assessed: number;
}

export function directoryStats(rows: DirectoryRow[]): DirectoryStats {
  const departments = new Set(
    rows.map((r) => r.department).filter((d) => d && d !== '—'),
  );
  return {
    total: rows.length,
    admins: rows.filter((r) => r.role === 'admin').length,
    departments: departments.size,
    assessed: rows.filter((r) => r.readiness !== null).length,
  };
}

/** Human label for a readiness value in the directory table. */
export function readinessLabel(readiness: number | null): string {
  return readiness === null ? 'Not assessed' : `${readiness}%`;
}
