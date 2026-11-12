/** How many fallback tones the stylesheet defines. */
const TONES = 6;
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function linear(channel: string): number {
  const value = parseInt(channel, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * A calendar's colour in the calendar view. Google's own colour keeps its hue,
 * so a calendar is recognisable from Google Calendar, but takes the lightness
 * and restraint of the app's tones so it reads on either theme. A calendar
 * with no usable colour takes a tone by its position.
 */
export function calendarTone(
  color: string | null | undefined,
  index: number,
): string {
  const match = color ? HEX.exec(color) : null;
  if (!match) return `var(--google-calendar-tone-${index % TONES})`;
  const [r, g, b] = [linear(match[1]!), linear(match[2]!), linear(match[3]!)];
  // sRGB to OKLab (Björn Ottosson); only chroma and hue are kept.
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.min(Math.hypot(a, bb), 0.14);
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return `oklch(55% ${chroma.toFixed(3)} ${((hue + 360) % 360).toFixed(0)})`;
}
