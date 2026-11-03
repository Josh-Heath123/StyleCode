const svgCursor = (svg: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

const ROTATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 12.5a6.5 6.5 0 1 1-2.2-4.9" stroke="#fff" stroke-width="4"/><path d="M17.5 4v4h-4" stroke="#fff" stroke-width="4"/><path d="M18.5 12.5a6.5 6.5 0 1 1-2.2-4.9" stroke="#000" stroke-width="1.6"/><path d="M17.5 4v4h-4" stroke="#000" stroke-width="1.6"/></g></svg>`;

export const ROTATE_CURSOR = svgCursor(ROTATE_SVG, 12, 12, 'crosshair');

/** The resize cursor closest to a handle direction given in screen degrees (0 = east, 90 = south). */
export function resizeCursor(angleDeg: number): string {
  const a = ((angleDeg % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
}
