export const minimumDataverseMapZoom = .4;
export const maximumDataverseMapZoom = 8;
const zoomFactor = 1.2;

export function clampDataverseMapZoom(value: number): number {
  return Math.min(maximumDataverseMapZoom, Math.max(minimumDataverseMapZoom, value));
}

/** Multiplies by 20% per step so high zoom levels are a few clicks away instead of dozens. */
export function stepDataverseMapZoom(current: number, direction: 1 | -1): number {
  const next = direction > 0 ? current * zoomFactor : current / zoomFactor;
  return clampDataverseMapZoom(Math.round(next * 100) / 100);
}
