import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IgotCourse } from '../types';
import { SupabaseMockIgotAdapter } from './adapter';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  },
}));

interface QueryResult {
  data: unknown;
  error: unknown;
}

/** Minimal stand-in for a Supabase query builder: chainable and awaitable. */
class FakeQuery implements PromiseLike<QueryResult> {
  private readonly result: QueryResult;

  constructor(result: QueryResult) {
    this.result = result;
  }

  select(): FakeQuery {
    return this;
  }
  eq(): FakeQuery {
    return this;
  }
  order(): FakeQuery {
    return this;
  }
  contains(): FakeQuery {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const COURSE: IgotCourse = {
  id: 'course-1',
  external_id: 'MOCK-001',
  title: 'Survey Design Fundamentals',
  provider: 'NSO',
  duration_hrs: 4,
  competency_tags: ['Survey Methodology'],
  url: '#',
  is_mock: true,
};

/** 42P10 is the exact error the missing unique key produced in production. */
const MISSING_CONSTRAINT = {
  code: '42P10',
  message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  details: null,
  hint: null,
};

const GAPS = [{ competency: 'Survey Methodology', mastery: 0 }];

function recommendationsTable(
  select: () => FakeQuery,
  upsert: () => FakeQuery,
): unknown {
  return { select, upsert };
}

describe('SupabaseMockIgotAdapter', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.from.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('reports a failed save as a warning and still returns the ranking', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'igot_courses') return new FakeQuery({ data: [COURSE], error: null });
      if (table === 'recommendations') {
        return recommendationsTable(
          () => new FakeQuery({ data: [], error: null }),
          () => new FakeQuery({ data: null, error: MISSING_CONSTRAINT }),
        );
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { recommendations, warning } = await new SupabaseMockIgotAdapter().listRecommendations(
      GAPS,
      [],
    );

    // The page stays useful...
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].course?.title).toBe('Survey Design Fundamentals');
    expect(recommendations[0].status).toBe('recommended');
    // ...and the database error is surfaced rather than swallowed.
    expect(warning).toContain('42P10');
  });

  it('returns saved rows with their real status when the save succeeds', async () => {
    const saved = {
      id: 'rec-1',
      user_id: 'user-1',
      course_id: 'course-1',
      competency_tag: 'Survey Methodology',
      reason: 'Targets your Survey Methodology gap',
      status: 'enrolled',
      progress: 40,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    mocks.from.mockImplementation((table: string) => {
      if (table === 'igot_courses') return new FakeQuery({ data: [COURSE], error: null });
      if (table === 'recommendations') {
        return recommendationsTable(
          () => new FakeQuery({ data: [saved], error: null }),
          () => new FakeQuery({ data: null, error: null }),
        );
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { recommendations, warning } = await new SupabaseMockIgotAdapter().listRecommendations(
      GAPS,
      [],
    );

    expect(warning).toBeNull();
    expect(recommendations[0].id).toBe('rec-1');
    expect(recommendations[0].status).toBe('enrolled');
    expect(recommendations[0].progress).toBe(40);
  });

  it('fails loudly when enrollment matches no saved recommendation', async () => {
    mocks.from.mockImplementation(() => ({
      update: () => new FakeQuery({ data: [], error: null }),
    }));

    await expect(new SupabaseMockIgotAdapter().enroll('course-1')).rejects.toThrow(
      /not recorded/,
    );
  });
});
