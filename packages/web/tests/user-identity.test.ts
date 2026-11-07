import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getOrCreateUserIdentity,
  saveUserNickname,
  worldToViewportPixel,
} from '../src/features/collaboration/user-identity';

describe('UserIdentity & Coordinate Projection', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  it('marks first visit when identity is newly created and clears flag after saving nickname', () => {
    const initial = getOrCreateUserIdentity();
    expect(initial.clientId).toMatch(/^client-/);
    expect(initial.isFirstVisit).toBe(true);
    expect(initial.color).toMatch(/^#[0-9A-F]{6}$/i);

    const updated = saveUserNickname('架构师老张');
    expect(updated.nickname).toBe('架构师老张');
    expect(updated.isFirstVisit).toBe(false);
    expect(getOrCreateUserIdentity().isFirstVisit).toBe(false);
  });

  it('converts flow world coordinates to viewport pixel coordinates accurately', () => {
    const pixel = worldToViewportPixel({ x: 100, y: 200 }, { x: 50, y: -30, zoom: 1.5 });
    expect(pixel).toEqual({ x: 100 * 1.5 + 50, y: 200 * 1.5 - 30 });
  });
});
