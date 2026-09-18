import type { IgotCourse } from '../types';

/**
 * Build personalized iGOT course recommendations from competency gaps.
 * Pure functions — unit-tested in src/lib/igot/matcher.test.ts.
 */

export interface GapInput {
  competency: string;
  mastery: number;
}

export interface RankedCourse {
  course: IgotCourse;
  score: number;
  matchedTags: string[];
  reason: string;
}

/** Urgency weight: mastery 0 → weight 60, mastery 59 → ~1. */
export function gapUrgency(mastery: number): number {
  return Math.max(0, 60 - mastery);
}

/**
 * Score = Σ over matched competency tags of that gap's urgency.
 * Matches a course to a gap when the course lists the tag.
 * Ties broken by shorter duration (less time out of the field).
 */
export function rankCourses(gaps: GapInput[], courses: IgotCourse[]): RankedCourse[] {
  const urgency = new Map(gaps.map((g) => [g.competency, gapUrgency(g.mastery)]));

  const ranked = courses.map<RankedCourse>((course) => {
    const matchedTags = course.competency_tags.filter((t) => urgency.has(t));
    const score = matchedTags.reduce((acc, t) => acc + (urgency.get(t) ?? 0), 0);
    const tagList = matchedTags.join(' + ');
    const reason =
      matchedTags.length > 0
        ? `Targets your ${tagList} gap${matchedTags.length > 1 ? 's' : ''}`
        : 'General capacity building';
    return { course, score, matchedTags, reason };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.course.duration_hrs - b.course.duration_hrs,
    );
}
