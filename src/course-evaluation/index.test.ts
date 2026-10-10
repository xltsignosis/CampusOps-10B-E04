import { coordinateRefresh } from './index';
import type { AuthEvent } from './contracts';

describe('coordinateRefresh', () => {
  test('starts without a persisted session', () => {
    expect(coordinateRefresh([])).toEqual({
      status: 'anonymous',
      activeGeneration: null,
      refreshCalls: 0,
      retriedRequestIds: [],
      persistedToken: null,
    });
  });

  test('shares an in-flight refresh and waits for success before retrying', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'request401', requestId: 'b', generation: 0 },
      { type: 'request401', requestId: 'c', generation: 0 },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 0,
      refreshCalls: 1,
      retriedRequestIds: [],
      persistedToken: null,
    });
  });

  test('retries duplicate request IDs once and prevents refresh loops', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'request401', requestId: 'b', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
      { type: 'request401', requestId: 'a', generation: 1 },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['a', 'b'],
      persistedToken: 'course-token-1',
    });
  });

  test('retries late 401s with the current token without another refresh', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
      { type: 'request401', requestId: 'b', generation: 0 },
      { type: 'request401', requestId: 'b', generation: 0 },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['a', 'b'],
      persistedToken: 'course-token-1',
    });
  });

  test('allows one new refresh when a new generation expires', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
      { type: 'request401', requestId: 'b', generation: 1 },
      { type: 'request401', requestId: 'c', generation: 1 },
      { type: 'refreshSucceeded', generation: 2, token: 'course-token-2' },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 2,
      refreshCalls: 2,
      retriedRequestIds: ['a', 'b', 'c'],
      persistedToken: 'course-token-2',
    });
  });

  test('ignores stale outcomes while a newer refresh is in flight', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
      { type: 'request401', requestId: 'b', generation: 1 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-stale' },
      { type: 'refreshFailed', generation: 0 },
      { type: 'refreshFailed', generation: 1 },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 2,
      retriedRequestIds: ['a'],
      persistedToken: 'course-token-1',
    });
  });

  test.each<AuthEvent>([
    { type: 'refreshFailed' },
    { type: 'refreshFailed', generation: 2 },
    { type: 'logout' },
  ])('clears a session on $type and ignores late events ($generation)', (closingEvent) => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
      { type: 'request401', requestId: 'b', generation: 1 },
      closingEvent,
      { type: 'refreshSucceeded', generation: 2, token: 'course-token-late' },
      { type: 'request401', requestId: 'c', generation: 1 },
    ])).toEqual({
      status: 'anonymous',
      activeGeneration: null,
      refreshCalls: 2,
      retriedRequestIds: ['a'],
      persistedToken: null,
    });
  });

  test('discards pending requests when the first refresh fails', () => {
    expect(coordinateRefresh([
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'request401', requestId: 'b', generation: 0 },
      { type: 'refreshFailed', generation: 1 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-late' },
    ])).toEqual({
      status: 'anonymous',
      activeGeneration: null,
      refreshCalls: 1,
      retriedRequestIds: [],
      persistedToken: null,
    });
  });

  test('ignores refresh outcomes without an in-flight refresh', () => {
    expect(coordinateRefresh([
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-late' },
      { type: 'refreshFailed', generation: 1 },
    ])).toEqual(coordinateRefresh([]));
  });

  test('handles omitted generations without mutating events', () => {
    const events = Object.freeze([
      Object.freeze({ type: 'request401', requestId: 'a' } as const),
      Object.freeze({ type: 'refreshSucceeded', token: 'course-token-1' } as const),
    ]);
    expect(coordinateRefresh(events)).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['a'],
      persistedToken: 'course-token-1',
    });
  });

  test('ignores incomplete events and generations outside the active refresh', () => {
    expect(coordinateRefresh([
      { type: 'request401', generation: 0 },
      { type: 'request401', requestId: 'a', generation: 0 },
      { type: 'request401', requestId: 'future', generation: 2 },
      { type: 'refreshSucceeded', generation: 1 },
      { type: 'refreshSucceeded', generation: 0, token: 'course-token-stale' },
      { type: 'refreshSucceeded', generation: 2, token: 'course-token-future' },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-1' },
    ])).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['a'],
      persistedToken: 'course-token-1',
    });
  });
});
