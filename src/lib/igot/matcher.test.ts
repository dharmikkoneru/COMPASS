import { describe, expect, it } from 'vitest';
import { rankCourses } from './matcher';
import type { IgotCourse } from '../types';

function course(partial: Partial<IgotCourse>): IgotCourse {
  return {
    id: partial.external_id ?? 'x',
    external_id: partial.external_id ?? 'x',
    title: 'Course',
    provider: 'MoSPI',
    duration_hrs: 4,
    competency_tags: [],
    url: '#',
    is_mock: true,
    ...partial,
  };
}

describe('rankCourses', () => {
  it('scores courses by summed gap urgency over matched tags', () => {
    const gaps = [
      { competency: 'Sampling Techniques', mastery: 20 }, // urgency 40
      { competency: 'Survey Methodology', mastery: 50 }, // urgency 10
    ];
    const courses = [
      course({ id: 'a', competency_tags: ['Sampling Techniques'] }),
      course({ id: 'b', competency_tags: ['Sampling Techniques', 'Survey Methodology'] }),
      course({ id: 'c', competency_tags: ['Statistical Computing'] }),
    ];
    const ranked = rankCourses(gaps, courses);
    expect(ranked.map((r) => r.course.id)).toEqual(['b', 'a']);
    expect(ranked[0].score).toBe(50);
    expect(ranked[1].score).toBe(40);
  });

  it('drops courses that match no gap', () => {
    const ranked = rankCourses(
      [{ competency: 'Sampling Techniques', mastery: 30 }],
      [course({ id: 'x', competency_tags: ['Data Governance & Privacy'] })],
    );
    expect(ranked).toHaveLength(0);
  });

  it('breaks ties by shorter duration', () => {
    const gaps = [{ competency: 'Sampling Techniques', mastery: 30 }];
    const ranked = rankCourses(gaps, [
      course({ id: 'long', duration_hrs: 8, competency_tags: ['Sampling Techniques'] }),
      course({ id: 'short', duration_hrs: 2, competency_tags: ['Sampling Techniques'] }),
    ]);
    expect(ranked[0].course.id).toBe('short');
  });

  it('produces a human-readable reason citing matched gaps', () => {
    const ranked = rankCourses(
      [{ competency: 'Data Quality & Validation', mastery: 10 }],
      [course({ id: 'q', competency_tags: ['Data Quality & Validation'] })],
    );
    expect(ranked[0].reason).toContain('Data Quality & Validation');
  });
});
