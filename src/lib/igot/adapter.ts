import { COMPETENCIES, type Competency } from '../competencies';
import { errorMessage } from '../errors';
import { supabase } from '../supabase';
import type { CompetencyMastery, IgotCourse, Recommendation } from '../types';
import { rankCourses, type GapInput, type RankedCourse } from './matcher';

/**
 * iGOT Karmayogi integration boundary.
 *
 * The real iGOT platform has no free public API for third-party apps, so
 * the demo runs against a mock catalog seeded in Supabase (igot_courses,
 * is_mock = true). Swapping in the real API later means implementing this
 * interface against the actual endpoints — no other code changes.
 *
 * Real-API notes (RestIgotAdapter sketch):
 *   listCourses()          → GET {IGOT_BASE_URL}/api/v1/courses
 *   searchByCompetency(t)  → GET .../courses?competency={tag}
 *   enroll(courseId)       → POST .../courses/{id}/enrol
 *   syncProgress(user)     → GET .../users/{id}/progress
 * with a service account token cached in Supabase Vault.
 */
export interface IgotAdapter {
  listCourses(): Promise<IgotCourse[]>;
  searchByCompetency(tag: string): Promise<IgotCourse[]>;
  enroll(courseId: string): Promise<void>;
  updateProgress(courseId: string, progress: number): Promise<void>;
  listRecommendations(
    gaps: GapInput[],
    masteryRows: CompetencyMastery[],
  ): Promise<RecommendationSet>;
}

export interface RecommendationSet {
  recommendations: Recommendation[];
  /**
   * A non-fatal problem worth showing, e.g. the ranking could not be saved.
   * `null` when everything worked. Fatal problems (catalogue unreachable,
   * not signed in) are thrown instead.
   */
  warning: string | null;
}

export class SupabaseMockIgotAdapter implements IgotAdapter {
  async listCourses(): Promise<IgotCourse[]> {
    const { data, error } = await supabase
      .from('igot_courses')
      .select('*')
      .order('provider');
    if (error) throw error;
    return (data ?? []) as IgotCourse[];
  }

  async searchByCompetency(tag: string): Promise<IgotCourse[]> {
    const { data, error } = await supabase
      .from('igot_courses')
      .select('*')
      .contains('competency_tags', [tag]);
    if (error) throw error;
    return (data ?? []) as IgotCourse[];
  }

  private async currentUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  }

  async enroll(courseId: string): Promise<void> {
    const userId = await this.currentUserId();
    const { data, error } = await supabase
      .from('recommendations')
      .update({ status: 'enrolled', progress: 0 })
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    // An update matching no rows still reports success. Treating that as a
    // successful enrolment is how a broken recommendation silently pretends
    // to work.
    if (!data || data.length === 0) {
      throw new Error(
        'That course is not saved as a recommendation on your account, so the enrolment was not recorded.',
      );
    }
  }

  async updateProgress(courseId: string, progress: number): Promise<void> {
    const userId = await this.currentUserId();
    const { data, error } = await supabase
      .from('recommendations')
      .update({
        progress,
        status: progress >= 100 ? 'completed' : 'in_progress',
      })
      .eq('course_id', courseId)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(
        'That course is not saved as a recommendation on your account, so your progress was not recorded.',
      );
    }
  }

  /**
   * Rank the seeded catalog against the officer's competency gaps.
   *
   * Reads are fatal — without the catalogue there is nothing to show. Saving
   * the ranking is best effort: a course we could not store is still the right
   * course to train on, so the fresh ranking is returned either way and the
   * failure is reported in `warning` rather than blanking the page.
   */
  async listRecommendations(
    gaps: GapInput[],
    masteryRows: CompetencyMastery[],
  ): Promise<RecommendationSet> {
    const userId = await this.currentUserId();

    const courses = await this.listCourses();
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const ranked = rankCourses(gaps, courses).slice(0, 6);

    const existing = await supabase
      .from('recommendations')
      .select('*')
      .eq('user_id', userId);
    if (existing.error) throw existing.error;
    const prior = (existing.data ?? []) as Recommendation[];

    let warning: string | null = null;
    try {
      await this.persistRanking(userId, ranked, prior);
    } catch (err) {
      warning =
        `Recommendations could not be saved: ${errorMessage(err, 'unknown error')}. ` +
        'The ranking below is live for this session, but enrolment and progress will not persist.';
    }

    // Only worth re-reading when the write actually landed.
    let saved = prior;
    if (!warning) {
      const fresh = await supabase
        .from('recommendations')
        .select('*')
        .eq('user_id', userId);
      if (fresh.error) throw fresh.error;
      saved = (fresh.data ?? []) as Recommendation[];
    }

    const savedByCourse = new Map(saved.map((r) => [r.course_id, r]));
    const recommendations: Recommendation[] = [];
    const seen = new Set<string>();

    // Ranked order first — urgency is the point of the page.
    for (const r of ranked) {
      const row = savedByCourse.get(r.course.id);
      let rec: Recommendation;
      if (row) {
        rec = { ...row, course: r.course };
      } else {
        rec = {
          // Not persisted yet (write failed, or first render before the row
          // exists). Enrollment on this id fails loudly instead of no-oping.
          id: `unsaved:${r.course.id}`,
          user_id: userId,
          course_id: r.course.id,
          competency_tag: r.matchedTags[0] ?? r.course.competency_tags[0],
          reason: r.reason,
          status: 'recommended',
          progress: 0,
          created_at: new Date().toISOString(),
          course: r.course,
        };
      }
      recommendations.push(rec);
      seen.add(r.course.id);
    }

    // Keep engaged courses visible even once they drop out of the top ranking —
    // an officer must not lose sight of training already under way.
    for (const row of saved) {
      if (seen.has(row.course_id) || row.status === 'recommended') continue;
      const course = courseById.get(row.course_id);
      if (course) recommendations.push({ ...row, course });
    }

    void masteryRows;
    return { recommendations, warning };
  }

  /**
   * Upsert the ranking, never clobbering a course the officer has already
   * enrolled in or started.
   */
  private async persistRanking(
    userId: string,
    ranked: RankedCourse[],
    prior: Recommendation[],
  ): Promise<void> {
    const engaged = new Set(
      prior.filter((r) => r.status !== 'recommended').map((r) => r.course_id),
    );

    for (const rec of ranked) {
      if (engaged.has(rec.course.id)) continue;
      const already = prior.find((r) => r.course_id === rec.course.id);
      if (already && already.reason === rec.reason) continue;

      const { error } = await supabase.from('recommendations').upsert(
        {
          user_id: userId,
          course_id: rec.course.id,
          competency_tag: rec.matchedTags[0] ?? rec.course.competency_tags[0],
          reason: rec.reason,
          status: 'recommended',
        },
        { onConflict: 'user_id,course_id' },
      );
      if (error) throw error;
    }
  }
}

/** convenience: gaps from mastery rows, threshold applied client-side */
export function gapsFromMastery(
  rows: CompetencyMastery[],
  threshold: number,
  competencies: readonly Competency[] = COMPETENCIES,
): GapInput[] {
  const map = new Map(rows.map((r) => [r.competency_tag, Number(r.mastery)]));
  return competencies
    .map((c) => ({ competency: c, mastery: map.get(c) ?? 0 }))
    .filter((g) => g.mastery < threshold);
}
