import type { Point, Rect } from '../model/types';

/** Screen position = world position × zoom + (x, y). */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}

/** Zooms so the world point under `screenPoint` stays under it. */
export function zoomAt(camera: Camera, screenPoint: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = screenToWorld(camera, screenPoint);
  return { zoom: next, x: screenPoint.x - world.x * next, y: screenPoint.y - world.y * next };
}

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? MIN_ZOOM;
}

/** A camera that fits `rect` into a viewport of the given size. */
export function fitRect(rect: Rect, viewport: { width: number; height: number }, padding = 64, maxZoom = 1): Camera {
  const availableW = Math.max(1, viewport.width - padding * 2);
  const availableH = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, availableW / Math.max(1, rect.width), availableH / Math.max(1, rect.height)));
  return {
    zoom,
    x: viewport.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * zoom,
  };
}
