/**
 * Demo scheduling guardrails (pure helpers, no I/O).
 *
 * The scheduling agent must never pick a demo time on the lead's behalf. A slot only counts when the
 * lead's OWN newest words (quoted history and signature already stripped) name a specific day AND a
 * specific clock time, or clearly pick one of the slots we offered in our last reply. Bare numbers
 * ("team of 5", phone numbers, years) never count as a time.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface OfferedSlot {
  date: string; // YYYY-MM-DD
  startHour: number; // 0-23
  label: string;
}

/** Weekday indexes (0 = Sunday) explicitly named in the text. */
export function namedWeekdays(text: string): number[] {
  const t = text.toLowerCase();
  const out = new Set<number>();
  WEEKDAYS.forEach((d, i) => {
    if (new RegExp(`\\b${d}\\b`).test(t)) out.add(i);
  });
  WEEKDAY_SHORT.forEach((d, i) => {
    if (new RegExp(`\\b${d}\\b\\.?`).test(t) && !/\bsat\s+(down|on|with)\b/.test(t)) out.add(i);
  });
  // "tues", "thurs", "weds"
  if (/\btues\b/.test(t)) out.add(2);
  if (/\bweds\b/.test(t)) out.add(3);
  if (/\bthurs?\b/.test(t)) out.add(4);
  return Array.from(out);
}

/** True when the text names a concrete day (today, tomorrow, a weekday, or a calendar date). */
export function hasExplicitDateToken(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(today|tonight|tomorrow|tmrw|tmr|day after tomorrow)\b/.test(t)) return true;
  if (namedWeekdays(t).length > 0) return true;
  const month = `(?:${MONTHS.join('|')})[a-z]*\\.?`;
  if (new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?${month}\\b`).test(t)) return true; // 21 Oct, 21st of October
  if (new RegExp(`\\b${month}\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`).test(t)) return true; // Oct 21
  if (/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/.test(t) && !/\b\d{1,2}[.:]\d{2}\s*(am|pm)\b/.test(t)) return true; // 21/10
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/.test(t)) return true; // "the 21st"
  return false;
}

export interface TimeParse {
  /** A real clock time was written (4pm, 16:00, at 4, 4 o'clock, noon). */
  hasTime: boolean;
  /** Possible 24h start hours for what was written ("at 4" -> [4, 16]). */
  hourCandidates: number[];
  /** A time was given with non-zero minutes (4:30) - demos start on the hour. */
  hasNonZeroMinutes: boolean;
}

/** Strict clock-time parsing. A bare number on its own is NEVER a time. */
export function parseExplicitTime(text: string): TimeParse {
  let t = text.toLowerCase().replace(/\s+/g, ' ');
  const hours = new Set<number>();
  let hasNonZeroMinutes = false;
  const both = (h: number) => {
    if (h >= 0 && h <= 23) hours.add(h);
    if (h >= 1 && h <= 11) hours.add(h + 12);
  };
  const withSuffix = (h: number, suffix: string) => {
    const pm = suffix.startsWith('p');
    if (h < 1 || h > 12) return;
    hours.add(pm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h);
  };

  let m: RegExpExecArray | null;

  // Ranges with a suffix: "4-5pm", "4 to 5 pm" -> start hour 4pm
  const rangeRe = /\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)/g;
  while ((m = rangeRe.exec(t))) {
    withSuffix(parseInt(m[1], 10), m[4].replace(/[.\s]/g, ''));
    if (m[2] && m[2] !== '00') hasNonZeroMinutes = true;
  }
  // The end of a range is not a start time.
  t = t.replace(rangeRe, ' ');

  // "4pm", "4:30 pm", "4 p.m."
  const ampmRe = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/g;
  while ((m = ampmRe.exec(t))) {
    withSuffix(parseInt(m[1], 10), m[3].replace(/[.\s]/g, ''));
    if (m[2] && m[2] !== '00') hasNonZeroMinutes = true;
  }

  // "16:00", "4:00" (24h or ambiguous)
  const colonRe = /\b(\d{1,2}):(\d{2})\b(?!\s*(?:a\.?\s?m|p\.?\s?m))/g;
  while ((m = colonRe.exec(t))) {
    const h = parseInt(m[1], 10);
    if (h > 23 || parseInt(m[2], 10) > 59) continue;
    if (m[2] !== '00') hasNonZeroMinutes = true;
    if (h >= 13) hours.add(h);
    else both(h);
  }

  // "1600 hrs", "16 hrs"
  const hrsRe = /\b(\d{1,2})(\d{2})?\s*hrs?\b/g;
  while ((m = hrsRe.exec(t))) {
    const h = parseInt(m[1], 10);
    if (h <= 23) hours.add(h);
    if (m[2] && m[2] !== '00') hasNonZeroMinutes = true;
  }

  // "at 4", "around 4", "by 4" (not "at 4 people", "at 5%")
  const atRe = /\b(?:at|around|by|after|before)\s+(\d{1,2})\b(?!\s*(?:%|people|persons|users|agents|members|pax|seats|staff|employees|branches|offices|days?|weeks?|months?|years?|mins?|minutes?|hours?|[:./-]\d))/g;
  while ((m = atRe.exec(t))) both(parseInt(m[1], 10));

  // "4 o'clock"
  const oclockRe = /\b(\d{1,2})\s*o'?\s?clock\b/g;
  while ((m = oclockRe.exec(t))) both(parseInt(m[1], 10));

  if (/\bnoon\b|\bmidday\b/.test(t)) hours.add(12);

  return { hasTime: hours.size > 0, hourCandidates: Array.from(hours).sort((a, b) => a - b), hasNonZeroMinutes };
}

/** "morning" / "afternoon" / "evening" without a clock time. */
export function preferredPeriodOf(text: string): 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY' {
  const t = text.toLowerCase();
  if (/\bmorning\b/.test(t)) return 'MORNING';
  if (/\bafternoon\b|\bpost\s*lunch\b|\bafter\s+lunch\b/.test(t)) return 'AFTERNOON';
  if (/\bevening\b|\btonight\b/.test(t)) return 'EVENING';
  return 'ANY';
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** A short, clear yes ("yes", "confirm", "book it", "that works"). */
export function isAffirmative(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t || wordCount(t) > 30) return false;
  if (isNegative(t)) return false;
  return /\b(yes|yeah|yea|yep|yup|ya|haan|ha|sure|ok|okay|okk?|confirm(ed)?|please (do|book|confirm|go ahead)|book it|go ahead|sounds good|that works|works for me|works fine|perfect|great|done|absolutely|definitely|fine with me|that'?s fine|lock it|correct|right)\b/.test(
    t
  );
}

/** A clear no / not that one. */
export function isNegative(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(no|nope|nah|not\s+(that|this|then|available|possible|good|ok|okay)|don'?t|do not|can'?t|cannot|won'?t|wouldn'?t work|doesn'?t work|not free|busy then|another (time|day|slot)|different (time|day|slot)|some other)\b/.test(
    t
  );
}

/** Cheap pre-check so callers only read stored scheduling state for messages that could continue a scheduling exchange. */
export function looksLikeSchedulingFollowUp(text: string): boolean {
  if (!text) return false;
  return (
    hasExplicitDateToken(text) ||
    parseExplicitTime(text).hasTime ||
    isAffirmative(text) ||
    isNegative(text) ||
    /\b(morning|afternoon|evening|first|second|third|last|option|slot|1st|2nd|3rd)\b/i.test(text)
  );
}

/**
 * Which of the slots we offered did the lead pick? Returns an index or null.
 * Accepts: "the second one", "option 2", "#2", a bare "2" in a very short reply,
 * or a day/time that matches exactly one offered slot.
 */
export function pickOfferedSlot(text: string, offered: OfferedSlot[], dayOfWeekFor: (date: string) => number): number | null {
  if (!offered.length) return null;
  const t = text.toLowerCase();

  // "first available" / "1st week of" are not picks; month dates ("2nd Nov") are handled by day/time matching below.
  const notAPick = /\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+(available|possible|week|half|of)\b/;
  const ordinals: Array<[RegExp, number]> = [
    [/\b(first|1st)\b/, 0],
    [/\b(second|2nd)\b/, 1],
    [/\b(third|3rd)\b/, 2],
    [/\b(fourth|4th)\b/, 3],
  ];
  if (!notAPick.test(t) && !hasMonthName(t)) {
    for (const [re, idx] of ordinals) {
      if (re.test(t) && idx < offered.length) return idx;
    }
  }
  if (/\blast (one|slot|option)\b/.test(t)) return offered.length - 1;

  const opt = t.match(/\b(?:option|slot|choice|number|no\.?)\s*#?\s*(\d)\b|#\s*(\d)\b/);
  if (opt) {
    const n = parseInt(opt[1] || opt[2], 10) - 1;
    if (n >= 0 && n < offered.length) return n;
  }
  if (wordCount(t) <= 3) {
    const bare = t.match(/^\D*(\d)\D*$/);
    if (bare) {
      const n = parseInt(bare[1], 10) - 1;
      if (n >= 0 && n < offered.length && !parseExplicitTime(t).hasTime) return n;
    }
  }

  // Match by the day and/or time the lead wrote.
  const days = namedWeekdays(t);
  const time = parseExplicitTime(t);
  if (!days.length && !time.hasTime) return null;
  const matches = offered
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      const dayOk = days.length === 0 || days.includes(dayOfWeekFor(s.date));
      const timeOk = !time.hasTime || time.hourCandidates.includes(s.startHour);
      return dayOk && timeOk;
    });
  return matches.length === 1 ? matches[0].i : null;
}

/** Resolve "today", "tomorrow", "day after tomorrow" or a single named weekday to YYYY-MM-DD (next occurrence). */
export function resolveSimpleDate(
  text: string,
  now: { dateString: string; dayOfWeek: number },
  addDays: (dateString: string, days: number) => string
): string | null {
  const t = text.toLowerCase();
  if (/\bday after tomorrow\b/.test(t)) return addDays(now.dateString, 2);
  if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) return addDays(now.dateString, 1);
  if (/\b(today|tonight)\b/.test(t)) return now.dateString;
  const days = namedWeekdays(t);
  if (days.length !== 1) return null;
  let diff = (days[0] - now.dayOfWeek + 7) % 7;
  if (/\bnext\s+week\b/.test(t) && diff === 0) diff = 7;
  return addDays(now.dateString, diff);
}

/** A calendar date written with a month name ("2nd Nov", "Oct 21"). */
function hasMonthName(t: string): boolean {
  const month = `(?:${MONTHS.join('|')})[a-z]*\\.?`;
  return (
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?${month}\\b`).test(t) ||
    new RegExp(`\\b${month}\\s*\\d{1,2}(?:st|nd|rd|th)?\\b`).test(t)
  );
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * The lead's own words in a reply to our "Just to confirm..." question, and nothing else.
 *
 * Removes a leading subject line ("Re: ..."), our own earlier message when an email client pasted it
 * back without ">" or "wrote:" markers (a "Name<email>" header line, "Just to confirm...", the
 * 'Reply "Yes" to confirm, or tell me a different day and time' footer) and the sign-off. A stray word
 * from any of those ("different day", a subject containing "no") must never turn a plain "Yes" into a "no".
 * Returns '' when nothing is left; callers then fall back to the text they already had.
 */
export function leadReplyHead(text: string | null | undefined): string {
  let t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) return '';
  // Subject line(s) added in front of the body: "Re: ...", "Fwd: ..."
  t = t.replace(/^(?:[ \t]*(?:re|fwd?|fw)\s*:[^\n]*\n?)+/i, '');
  // A "Name<email@x.com>" (or "Name <email@x.com>") header line starts a pasted-back earlier message.
  t = t.replace(/(^|\n)[^\n<>]{0,80}<[^<>\s@]+@[^<>\s]+>[ \t]*(?:\n[\s\S]*)?$/, '');
  // Our own earlier question, pasted back.
  t = t.replace(/(^|\n)[ \t]*just to confirm[\s\S]*$/i, '');
  t = t.replace(/(^|\n)[ \t]*reply\s*["“”']?yes["“”']?\s*to confirm[\s\S]*$/i, '');
  // Sign-off and everything after it.
  t = t.replace(/\n\s*(regards|best regards|kind regards|warm regards|thanks|thank you|sincerely|cheers)\b[\s\S]*$/i, '');
  return t.trim();
}
