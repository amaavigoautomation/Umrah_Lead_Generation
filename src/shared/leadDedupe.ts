/**
 * Duplicate-email rules for campaign leads, shared by the browser (upload preview) and the server
 * (campaign creation), so both agree on what a duplicate is.
 *
 * Rule: within ONE campaign an email may appear only once. The same email in different campaigns is fine.
 * Two emails are the same when they match after trimming spaces and lower-casing. The FIRST occurrence
 * (lowest row number) is kept; later ones are skipped.
 */

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

export interface DuplicateInfo {
  rowNumber: number;
  email: string;
  duplicateOfRow: number;
}

/**
 * Marks repeated emails in an uploaded list. Duplicates get `isDuplicate: true`, `duplicateOfRow`, and
 * `isValid: false` (so every "valid leads" filter already excludes them).
 */
export function markDuplicateEmails<T extends { email?: string; rowNumber?: number; isValid?: boolean }>(
  list: T[]
): Array<T & { isDuplicate?: boolean; duplicateOfRow?: number }> {
  const firstRowByEmail = new Map<string, number>();
  return list.map((lead, idx) => {
    const key = normalizeEmail(lead.email);
    const row = lead.rowNumber || idx + 1;
    if (!key || lead.isValid === false) return { ...lead, isDuplicate: false };
    const firstRow = firstRowByEmail.get(key);
    if (firstRow !== undefined) {
      return { ...lead, isValid: false, isDuplicate: true, duplicateOfRow: firstRow };
    }
    firstRowByEmail.set(key, row);
    return { ...lead, isDuplicate: false };
  });
}

/** Summary counts for the upload preview. */
export function summarizeLeads(list: Array<{ isValid?: boolean; isDuplicate?: boolean }>) {
  const duplicates = list.filter((l) => l.isDuplicate).length;
  const unique = list.filter((l) => l.isValid && !l.isDuplicate).length;
  return { total: list.length, unique, duplicates, invalid: list.length - unique - duplicates };
}
