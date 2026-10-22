/**
 * Keyword-based Human Handoff rules.
 *
 * Matching is deliberately deterministic and case-insensitive. Administrators should
 * configure phrases rather than broad words to reduce accidental handoffs.
 */
export interface HumanHandoffMatch {
  matched: boolean;
  matchedPhrase?: string;
}

export function normalizeHandoffText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchHumanHandoffKeyword(
  message: string,
  configuredPhrases: readonly string[] = [],
): HumanHandoffMatch {
  const normalizedMessage = normalizeHandoffText(message);
  if (!normalizedMessage) return { matched: false };

  for (const phrase of configuredPhrases) {
    const normalizedPhrase = normalizeHandoffText(phrase);
    if (!normalizedPhrase) continue;

    // Match whole normalized phrases, not substrings (e.g. "call" won't match "callback").
    const paddedMessage = ` ${normalizedMessage} `;
    if (paddedMessage.includes(` ${normalizedPhrase} `)) {
      return { matched: true, matchedPhrase: phrase.trim() };
    }
  }

  return { matched: false };
}
