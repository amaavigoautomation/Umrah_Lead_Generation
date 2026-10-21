/**
 * Date/time helpers for a fixed IANA timezone (the workspace's), independent of the browser's own zone.
 * Used by the campaign scheduler: the user picks "15 Oct 10:00" meaning 10:00 in the workspace
 * timezone, and the server stores the exact UTC moment.
 */

/** Milliseconds the timezone is ahead of UTC at the given instant (handles DST). */
function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-10-15T10:00" (a datetime-local value) in `timeZone` -> UTC ISO string. Null if invalid. */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wallAsUtc - tzOffsetMs(wallAsUtc, timeZone);
  const corrected = wallAsUtc - tzOffsetMs(instant, timeZone); // second pass for DST edges
  if (corrected !== instant) instant = corrected;
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/** UTC instant -> "2026-10-15T10:00" in `timeZone` (for a datetime-local input's value / min). */
export function utcToZonedLocal(iso: string | number | Date, timeZone: string): string {
  const instant = new Date(iso).getTime();
  const wall = new Date(instant + tzOffsetMs(instant, timeZone));
  return wall.toISOString().slice(0, 16);
}

/** "Thu 15 Oct, 10:00 AM IST" in `timeZone`. */
export function formatZoned(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** "in 2d 19h", "in 45m", "now". */
export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 60_000) return 'starting now';
  const mins = Math.round(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
