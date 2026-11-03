import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { createDocument } from './document';
import { applyToPoint, invert, multiply, rotate, translate, worldBounds, worldCorners } from './geometry';
import { applyOps } from './ops';
import { resizeBox, rotateByDrag } from './transform';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('matrices', () => {
  it('inverts', () => {
    const m = multiply(translate(10, 20), rotate(33));
    const p = { x: 5, y: -7 };
    const back = applyToPoint(invert(m), applyToPoint(m, p));
    close(back.x, p.x);
    close(back.y, p.y);
  });
});

describe('world transforms', () => {
  it('follows the CSS box model: children sit inside the parent stroke', () => {
    const base = createDocument();
    const doc = applyOps(base, [
      {
        type: 'create',
        parentId: base.rootId,
        index: 0,
        nodes: [createNode('frame', { x: 100, y: 50, width: 400, height: 300, stroke: '#000000', strokeWidth: 4 }, 'f')],
      },
      { type: 'create', parentId: 'f', index: 0, nodes: [createNode('rect', { x: 10, y: 20, width: 50, height: 30 }, 'r')] },
    ]).doc;
    expect(worldBounds(doc, 'r')).toEqual({ x: 114, y: 74, width: 50, height: 30 });
  });

  it('rotates around the centre', () => {
    const base = createDocument();
    const doc = applyOps(base, [
      {
        type: 'create',
        parentId: base.rootId,
        index: 0,
        nodes: [createNode('rect', { x: 0, y: 0, width: 100, height: 50, rotation: 90 }, 'r')],
      },
    ]).doc;
    const [tl] = worldCorners(doc, 'r');
    // Centre (50, 25); after 90° the top-left corner moves to (75, -25).
    close(tl.x, 75);
    close(tl.y, -25);
    const b = worldBounds(doc, 'r');
    close(b.width, 50);
    close(b.height, 100);
  });
});

describe('resizeBox', () => {
  const box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

  it('drags the bottom-right corner with the top-left fixed', () => {
    expect(resizeBox(box, { hx: 1, hy: 1 }, { x: 350, y: 260 })).toEqual({ x: 100, y: 100, width: 250, height: 160 });
  });

  it('drags the left edge with the right edge fixed', () => {
    expect(resizeBox(box, { hx: -1, hy: 0 }, { x: 50, y: 999 })).toEqual({ x: 50, y: 100, width: 250, height: 100 });
  });

  it('flips when dragged past the opposite edge', () => {
    expect(resizeBox(box, { hx: 1, hy: 0 }, { x: 40, y: 0 })).toEqual({ x: 40, y: 100, width: 60, height: 100 });
  });

  it('keeps the aspect ratio with shift', () => {
    const r = resizeBox(box, { hx: 1, hy: 1 }, { x: 500, y: 150 }, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2, 6);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    expect(r.width).toBe(400);
  });

  it('resizes from the centre with alt', () => {
    expect(resizeBox(box, { hx: 1, hy: 0 }, { x: 320, y: 0 }, { fromCenter: true })).toEqual({
      x: 80,
      y: 100,
      width: 240,
      height: 100,
    });
  });

  it('keeps the anchor fixed for rotated boxes', () => {
    const rotated = { x: 0, y: 0, width: 100, height: 100, rotation: 45 };
    // The anchor (top-left in local space) must not move in parent space.
    const anchorBefore = applyToPoint(multiply(translate(50, 50), multiply(rotate(45), translate(-50, -50))), { x: 0, y: 0 });
    const r = resizeBox(rotated, { hx: 1, hy: 1 }, { x: 120, y: 160 });
    const m = multiply(
      translate(r.x + r.width / 2, r.y + r.height / 2),
      multiply(rotate(45), translate(-r.width / 2, -r.height / 2)),
    );
    const anchorAfter = applyToPoint(m, { x: 0, y: 0 });
    close(anchorAfter.x, anchorBefore.x);
    close(anchorAfter.y, anchorBefore.y);
  });

  it('never goes below the minimum size', () => {
    const r = resizeBox(box, { hx: 1, hy: 1 }, { x: 100, y: 100 });
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });
});

describe('rotateByDrag', () => {
  it('adds the swept angle and snaps', () => {
    const c = { x: 0, y: 0 };
    expect(rotateByDrag(0, c, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 6);
    expect(rotateByDrag(0, c, { x: 10, y: 0 }, { x: 10, y: 2 }, 15)).toBe(15);
    expect(rotateByDrag(170, c, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(-100, 6);
  });
});
