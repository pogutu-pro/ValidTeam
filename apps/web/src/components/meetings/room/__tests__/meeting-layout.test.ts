import { initials, MAX_STAGE_TILES, parseParticipantMeta, planGrid } from '../meeting-layout';

describe('planGrid', () => {
  it('adapts the layout to the number of participants', () => {
    expect(planGrid(1).className).toBe('grid-cols-1');
    expect(planGrid(2).className).toContain('sm:grid-cols-2');
    expect(planGrid(2).className.startsWith('grid-cols-1')).toBe(true); // stacked on phones
    expect(planGrid(4).className).toBe('grid-cols-2');
    expect(planGrid(7).className).toContain('sm:grid-cols-3');
    expect(planGrid(12).className).toContain('lg:grid-cols-4');
  });
  it('caps visible tiles and reports the overflow', () => {
    expect(planGrid(5)).toMatchObject({ visible: 5, overflow: 0 });
    expect(planGrid(MAX_STAGE_TILES + 6)).toMatchObject({ visible: MAX_STAGE_TILES, overflow: 6 });
    expect(planGrid(0).visible).toBe(0);
  });
});

describe('participant metadata', () => {
  it('parses role and participant id and tolerates garbage', () => {
    expect(parseParticipantMeta(JSON.stringify({ participantId: 'p1', role: 'guest' }))).toEqual({
      participantId: 'p1',
      role: 'guest',
    });
    expect(parseParticipantMeta('not json')).toEqual({ participantId: null, role: null });
    expect(parseParticipantMeta(JSON.stringify({ role: 'admin' })).role).toBeNull();
    expect(parseParticipantMeta(undefined)).toEqual({ participantId: null, role: null });
  });
  it('derives initials', () => {
    expect(initials('Paul Ogutu')).toBe('PO');
    expect(initials('  sarah ')).toBe('S');
    expect(initials('')).toBe('?');
  });
});

import { avatarTone, isTypingTarget } from '../meeting-layout';
import { parseReaction, REACTIONS } from '../reactions';

describe('avatarTone / typing guard', () => {
  it('is deterministic per name and always a known tone', () => {
    expect(avatarTone('Paul')).toBe(avatarTone('Paul'));
    expect(avatarTone('Paul')).toMatch(/^bg-accent-/);
    expect(avatarTone(undefined)).toMatch(/^bg-accent-/);
  });
  it('does not treat the document body as a typing target', () => {
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('parseReaction (data-channel input is untrusted)', () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  it('accepts only allow-listed reaction keys', () => {
    for (const r of REACTIONS) expect(parseReaction(enc({ r: r.key }))).toBe(r.key);
    expect(parseReaction(enc({ r: '<img src=x onerror=alert(1)>' }))).toBeNull();
    expect(parseReaction(enc({ r: '👍' }))).toBeNull(); // raw emoji is not a key
    expect(parseReaction(enc({ r: 42 }))).toBeNull();
    expect(parseReaction(new TextEncoder().encode('not json'))).toBeNull();
  });
});
