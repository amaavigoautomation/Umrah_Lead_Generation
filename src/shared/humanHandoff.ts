/**
 * Deterministic Human Handoff detection shared by email and WhatsApp pipelines.
 * Explicit negations are checked before positive intent to avoid false handoffs.
 */
export interface HumanHandoffMatch {
  matched: boolean;
  reason?: 'EXPLICIT_REQUEST' | 'FRUSTRATION' | 'AI_UNRESOLVED' | 'CUSTOM_PHRASE';
  matchedPhrase?: string;
}
export interface HumanHandoffRules {
  enabled?: boolean;
  explicitRequest?: boolean;
  frustration?: boolean;
  aiUnableToResolve?: boolean;
  failureThreshold?: number;
  customPhrases?: readonly string[];
}
export function normalizeHandoffText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function containsPhrase(text: string, phrases: readonly string[]): string | undefined {
  const padded = ` ${normalizeHandoffText(text)} `;
  return phrases.find((phrase) => {
    const normalized = normalizeHandoffText(phrase);
    return Boolean(normalized && padded.includes(` ${normalized} `));
  });
}
const EXPLICIT_REQUESTS = [
  'talk to a human','speak to a human','talk to a real person','speak to a real person',
  'connect me to a person','connect me to someone','speak to someone','talk to someone',
  'human agent','human representative','real representative','live representative',
  'customer support representative','speak to support','talk to support','speak to sales',
  'talk to sales','call me back','have someone call me','let me speak to a manager',
  'speak with a manager','connect me to the team','human support'
];
const NEGATED_REQUESTS = [
  'do not connect me to a human','dont connect me to a human','do not transfer me',
  'dont transfer me','i do not want a human','i dont want a human',
  'i do not want to speak to a human','i dont want to speak to a human',
  'no human needed','no need for a human','do not call me back','dont call me back'
];
const FRUSTRATION = [
  'you are not understanding me','you dont understand','you do not understand',
  'this is not helping','this isnt helping','not helpful at all','i already explained this',
  'i have explained this','i told you already','same question again','this is frustrating',
  'i am frustrated','im frustrated','very disappointed','this is unacceptable',
  'i want to speak to your manager','get me your manager','stop wasting my time'
];
export function matchHumanHandoffKeyword(message: string, configuredPhrases: readonly string[] = []): HumanHandoffMatch {
  const matchedPhrase = containsPhrase(message, configuredPhrases);
  return matchedPhrase ? { matched: true, reason: 'CUSTOM_PHRASE', matchedPhrase: matchedPhrase.trim() } : { matched: false };
}
export function detectHumanHandoff(
  message: string,
  rules: HumanHandoffRules = {},
  context: { unsuccessfulAttempts?: number } = {},
): HumanHandoffMatch {
  if (rules.enabled === false) return { matched: false };
  if (rules.explicitRequest === false && rules.frustration !== true && rules.aiUnableToResolve !== true && !(rules.customPhrases?.length)) return { matched: false };
  const normalized = normalizeHandoffText(message);
  if (!normalized || containsPhrase(normalized, NEGATED_REQUESTS)) return { matched: false };
  if (rules.explicitRequest !== false) {
    const phrase = containsPhrase(normalized, EXPLICIT_REQUESTS);
    if (phrase) return { matched: true, reason: 'EXPLICIT_REQUEST', matchedPhrase: phrase };
  }
  if (rules.frustration === true) {
    const phrase = containsPhrase(normalized, FRUSTRATION);
    if (phrase) return { matched: true, reason: 'FRUSTRATION', matchedPhrase: phrase };
  }
  if (rules.aiUnableToResolve === true && (context.unsuccessfulAttempts || 0) >= Math.max(1, rules.failureThreshold || 2)) {
    return { matched: true, reason: 'AI_UNRESOLVED', matchedPhrase: 'AI failed to resolve the query after repeated attempts' };
  }
  const custom = matchHumanHandoffKeyword(normalized, rules.customPhrases || []);
  return custom.matched ? custom : { matched: false };
}
