import { describe, expect, it } from 'vitest';
import {
  buildDirectory,
  directoryStats,
  filterDirectory,
  readinessLabel,
} from './adminUsers';
import type { Profile } from './types';

const profile = (over: Partial<Profile> & { id: string; email: string }): Profile => ({
  full_name: null,
  department: null,
  designation: null,
  role: 'officer',
  created_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

// Deliberately returns a wider object than MasteryAgg (the tag documents
// which competency the row belongs to) — structural typing accepts it.
const mastery = (user_id: string, competency_tag: string, m: number, attempts: number) => ({
  user_id,
  competency_tag,
  mastery: m,
  attempts,
});

describe('buildDirectory', () => {
  const profiles = [
    profile({ id: 'u1', email: 'officer@mospi.gov.in', full_name: 'Asha Rao', department: 'NSO', role: 'officer' }),
    profile({ id: 'u2', email: 'admin@mospi.gov.in', full_name: 'Dharmik Koneru', role: 'admin' }),
    profile({ id: 'u3', email: 'demo@compass.gov.in', full_name: 'Demo Officer' }),
  ];

  it('joins assessments and readiness per officer', () => {
    const rows = buildDirectory(profiles, [
      mastery('u1', 'Survey Methodology', 80, 4),
      mastery('u1', 'Sampling Techniques', 60, 2),
    ]);
    const asha = rows.find((r) => r.id === 'u1')!;
    expect(asha.assessments).toBe(6);
    expect(asha.readiness).toBe(70); // mean of 80 and 60
  });

  it('reports null readiness for an unassessed officer rather than 0%', () => {
    const rows = buildDirectory(profiles, []);
    expect(rows.find((r) => r.id === 'u3')!.readiness).toBeNull();
    expect(readinessLabel(null)).toBe('Not assessed');
  });

  it('falls back to email when no name is set, and to a dash for empty fields', () => {
    const rows = buildDirectory([profile({ id: 'u9', email: 'noname@nic.in', full_name: '   ' })], []);
    expect(rows[0].fullName).toBe('noname@nic.in');
    expect(rows[0].department).toBe('—');
    expect(rows[0].designation).toBe('—');
  });

  it('sorts the directory by name', () => {
    const rows = buildDirectory(profiles, []);
    expect(rows.map((r) => r.fullName)).toEqual(['Asha Rao', 'Demo Officer', 'Dharmik Koneru']);
  });
});

describe('filterDirectory', () => {
  const rows = buildDirectory(
    [
      profile({ id: 'u1', email: 'asha@mospi.gov.in', full_name: 'Asha Rao', department: 'NSO Field Ops' }),
      profile({ id: 'u2', email: 'demo@compass.gov.in', full_name: 'Demo Officer', department: 'Demo' }),
    ],
    [],
  );

  it('returns everything for an empty query', () => {
    expect(filterDirectory(rows, '   ')).toHaveLength(2);
  });

  it('matches name, email and department case-insensitively', () => {
    expect(filterDirectory(rows, 'asha')).toHaveLength(1);
    expect(filterDirectory(rows, 'MOSPI.GOV')).toHaveLength(1);
    expect(filterDirectory(rows, 'field')).toHaveLength(1);
  });

  it('returns no rows when nothing matches', () => {
    expect(filterDirectory(rows, 'zzz')).toHaveLength(0);
  });
});

describe('directoryStats', () => {
  it('counts totals, admins, distinct departments and assessed officers', () => {
    const rows = buildDirectory(
      [
        profile({ id: 'u1', email: 'a@mospi.gov.in', full_name: 'A', department: 'NSO' }),
        profile({ id: 'u2', email: 'b@mospi.gov.in', full_name: 'B', department: 'NSO' }),
        profile({ id: 'u3', email: 'c@mospi.gov.in', full_name: 'C', department: 'DES', role: 'admin' }),
      ],
      [mastery('u1', 'Survey Methodology', 50, 2)],
    );
    expect(directoryStats(rows)).toEqual({ total: 3, admins: 1, departments: 2, assessed: 1 });
  });

  it('ignores placeholder departments in the count', () => {
    const rows = buildDirectory([profile({ id: 'u1', email: 'a@b.in', full_name: 'A' })], []);
    expect(directoryStats(rows).departments).toBe(0);
  });
});
