/** @jest-environment node */
import { computeMeetingStats, mergeIntervals, peakConcurrent } from '../attendance';

const t = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00Z`);

describe('mergeIntervals', () => {
  it('merges overlaps and keeps gaps', () => {
    expect(
      mergeIntervals([
        [0, 10],
        [5, 20],
        [30, 40],
      ])
    ).toEqual([
      [0, 20],
      [30, 40],
    ]);
  });
});

describe('peakConcurrent', () => {
  it('does not count back-to-back as overlapping', () => {
    expect(peakConcurrent([[[0, 10]], [[10, 20]]])).toBe(1);
    expect(peakConcurrent([[[0, 10]], [[5, 20]]])).toBe(2);
  });
});

describe('computeMeetingStats — brief scenario', () => {
  // A: 10:00-10:20 + 10:30-11:00, B: 10:05-11:00, C: never joins. Meeting 10:00-11:00.
  const result = computeMeetingStats({
    window: { scheduledStartAt: t('10:00'), isInstant: false, endedAt: t('11:00') },
    participants: [
      { id: 'A', userId: 'ua' },
      { id: 'B', userId: 'ub' },
      { id: 'C', userId: 'uc' },
    ],
    sessions: [
      { participantId: 'A', joinedAt: t('10:00'), leftAt: t('10:20') },
      { participantId: 'A', joinedAt: t('10:30'), leftAt: t('11:00') },
      { participantId: 'B', joinedAt: t('10:05'), leftAt: t('11:00') },
    ],
  });
  const by = (id: string) => result.participants.find((p) => p.participantId === id)!;

  it('sums sessions, excluding the gap between leave and rejoin', () => {
    expect(by('A').attendedSeconds).toBe(50 * 60); // 20 + 30, not 60
    expect(by('B').attendedSeconds).toBe(55 * 60);
  });
  it('computes per-participant percentage against the meeting duration', () => {
    expect(result.durationSeconds).toBe(60 * 60);
    expect(by('A').attendancePct).toBe(83.3);
    expect(by('B').attendancePct).toBe(91.7);
  });
  it('counts joins, leaves and no-shows', () => {
    expect(by('A').joinCount).toBe(2);
    expect(by('A').leaveCount).toBe(2);
    expect(by('C').noShow).toBe(true);
    expect(result).toMatchObject({ invitedCount: 3, attendedCount: 2, noShowCount: 1 });
  });
  it('computes participant minutes, average and peak', () => {
    expect(result.totalParticipantSeconds).toBe(105 * 60);
    expect(result.avgAttendanceSeconds).toBe(Math.round((105 * 60) / 2));
    expect(result.peakConcurrent).toBe(2);
    expect(result.totalJoins).toBe(3);
    expect(result.totalLeaves).toBe(3);
    expect(result.avgAttendancePct).toBe(87.5);
  });
  it('flags late arrivals (>5 min) and early departures (>5 min before end)', () => {
    expect(by('A').lateArrival).toBe(false);
    expect(by('B').lateArrival).toBe(false); // 5 min is within grace
    expect(by('A').earlyDeparture).toBe(false);
  });
});

describe('computeMeetingStats — edge cases', () => {
  const window = { scheduledStartAt: t('10:00'), isInstant: false, endedAt: t('11:00') };

  it('closes sessions still open at meeting end (participant remained connected)', () => {
    const r = computeMeetingStats({
      window,
      participants: [{ id: 'A', userId: 'u' }],
      sessions: [{ participantId: 'A', joinedAt: t('10:30'), leftAt: null }],
    });
    expect(r.participants[0]).toMatchObject({ attendedSeconds: 30 * 60, leaveCount: 0 });
  });

  it('does not double count two simultaneous tabs of one participant', () => {
    const r = computeMeetingStats({
      window,
      participants: [{ id: 'A', userId: 'u' }],
      sessions: [
        { participantId: 'A', joinedAt: t('10:00'), leftAt: t('10:40') },
        { participantId: 'A', joinedAt: t('10:20'), leftAt: t('10:50') },
      ],
    });
    expect(r.participants[0]!.attendedSeconds).toBe(50 * 60);
    expect(r.peakConcurrent).toBe(1);
  });

  it('marks late arrival and early departure', () => {
    const r = computeMeetingStats({
      window,
      participants: [
        { id: 'H', userId: 'h' },
        { id: 'L', userId: 'l' },
      ],
      sessions: [
        { participantId: 'H', joinedAt: t('10:00'), leftAt: t('11:00') },
        { participantId: 'L', joinedAt: t('10:12'), leftAt: t('10:40') },
      ],
    });
    const l = r.participants.find((p) => p.participantId === 'L')!;
    expect(l.lateArrival).toBe(true);
    expect(l.earlyDeparture).toBe(true);
    expect(r.lateArrivals).toBe(1);
    expect(r.earlyDepartures).toBe(1);
  });

  it('is not late when the room itself opened late', () => {
    const r = computeMeetingStats({
      window,
      participants: [
        { id: 'A', userId: 'u' },
        { id: 'B', userId: 'v' },
      ],
      sessions: [
        { participantId: 'A', joinedAt: t('10:20'), leftAt: t('11:00') },
        { participantId: 'B', joinedAt: t('10:22'), leftAt: t('11:00') },
      ],
    });
    expect(r.lateArrivals).toBe(0);
  });

  it('leaves duration and averages unavailable when nobody joined', () => {
    const r = computeMeetingStats({
      window,
      participants: [{ id: 'A', userId: 'u' }],
      sessions: [],
    });
    expect(r).toMatchObject({
      durationSeconds: null,
      avgAttendanceSeconds: null,
      avgAttendancePct: null,
      noShowCount: 1,
      peakConcurrent: 0,
    });
    expect(r.participants[0]!.attendancePct).toBeNull();
  });

  it('ignores sessions that began after the meeting ended', () => {
    const r = computeMeetingStats({
      window,
      participants: [{ id: 'A', userId: 'u' }],
      sessions: [{ participantId: 'A', joinedAt: t('11:05'), leftAt: t('11:10') }],
    });
    expect(r.attendedCount).toBe(0);
  });
});
