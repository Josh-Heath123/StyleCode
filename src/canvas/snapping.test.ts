import { describe, expect, it } from 'vitest';
import { snapBox, type SnapTargets } from './snapping';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const targets = (...siblings: ReturnType<typeof rect>[]): SnapTargets => ({ rects: siblings, siblings });

describe('equal spacing', () => {
  it('gives a layer the same gap as its neighbours already have, and marks every such gap', () => {
    // Two cards 20 apart; a third dropped 3px short of the same gap after the second.
    const t = targets(rect(0, 0, 100, 50), rect(120, 0, 100, 50));
    const result = snapBox(rect(237, 10, 100, 30), t, 6);
    expect(result.dx).toBe(3);
    expect(result.guides.filter((g) => g.kind === 'gap').map((g) => [g.x1, g.x2, g.label])).toEqual([
      [100, 120, '20'],
      [220, 240, '20'],
    ]);
  });

  it('centres a layer between two neighbours', () => {
    const t = targets(rect(0, 0, 50, 50), rect(250, 0, 50, 50));
    // 100 wide between 50 and 250: equal gaps of 50 put it at 100.
    const result = snapBox(rect(104, 0, 100, 50), t, 6);
    expect(result.dx).toBe(-4);
    expect(result.guides.filter((g) => g.kind === 'gap').map((g) => g.label)).toEqual(['50', '50']);
  });

  it('prefers lining up an edge when that is closer, and ignores layers not level with it', () => {
    const t = targets(rect(0, 0, 100, 50), rect(120, 0, 100, 50), rect(242, 300, 80, 80));
    // Its left edge is 1px from the stray layer's edge below; equal spacing would need 3px.
    const result = snapBox(rect(241, 10, 60, 30), t, 6);
    expect(result.dx).toBe(1);
    expect(result.guides[0].kind).toBe('snap');
  });

  it('leaves resizing alone', () => {
    const t = targets(rect(0, 0, 100, 50), rect(120, 0, 100, 50));
    const result = snapBox(rect(237, 10, 100, 30), t, 6, { x: ['end'], y: ['end'] });
    expect(result.guides.some((g) => g.kind === 'gap')).toBe(false);
  });
});
