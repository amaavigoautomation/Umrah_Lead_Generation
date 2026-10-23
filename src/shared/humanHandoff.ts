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
  // Direct requests for a person, agent, representative, or operator.
  'talk to a human','speak to a human','talk with a human','speak with a human',
  'talk to a real person','speak to a real person','talk with a real person','speak with a real person',
  'i want a human','i need a human','i need a real person','let me talk to a person',
  'let me speak to a person','can i talk to a person','can i speak to a person',
  'connect me to a person','connect me with a person','connect me to someone','connect me with someone',
  'speak to someone','talk to someone','speak with someone','talk with someone',
  'human agent','live agent','real agent','actual person','real person please',
  'human representative','real representative','live representative','customer service agent',
  'customer support representative','speak to customer service','talk to customer service',
  'speak to customer support','talk to customer support','speak to support','talk to support',
  'contact support','get me support','transfer me to support','transfer me to an agent',
  'transfer me to a human','connect me to an agent','connect me with an agent',
  'put me through to an agent','put me through to a person','operator please',
  'speak to sales','talk to sales','connect me to sales','connect me with sales',
  'speak to the booking team','talk to the booking team','connect me to the booking team',
  'speak with the booking team','talk with the booking team','connect me with the booking team',
  'speak to a booking agent','connect me to a booking agent','umrah specialist please',
  'connect me to an umrah specialist','speak to an umrah specialist',
  'let me speak to a manager','i want to speak to a manager','speak with a manager',
  'get me your manager','i want a supervisor','speak to a supervisor',
  'call me back','please call me','have someone call me','i need someone to call me',
  'please have a person contact me','have your team contact me','contact me through a person',
  'human support','i want human assistance','i need human assistance','agent please',
  'real person please','stop the bot','stop talking like a bot','i want to talk to your team',
  'i need to talk to your team','can a person help me','can someone from your team help me'
];
const NEGATED_REQUESTS = [
  'do not connect me to a human','dont connect me to a human','do not transfer me',
  'dont transfer me','i do not want a human','i dont want a human',
  'i do not want to speak to a human','i dont want to speak to a human',
  'i do not want to talk to a human','i dont want to talk to a human',
  'i do not need a human','i dont need a human','no human needed','no need for a human',
  'no need to transfer me','do not call me back','dont call me back',
  'do not connect me to an agent','dont connect me to an agent',
  'i do not want an agent','i dont want an agent','i do not need an agent',
  'i can handle this myself','i will continue with the bot','keep helping me here',
  'just answer my question','answer me directly instead of transferring me'
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
/**
 * Counts recent AI replies that explicitly admit they could not resolve the request.
 * The inbound pipelines pass prior thread messages here before generating a new reply.
 */
export function countUnsuccessfulResolutionAttempts(messages: readonly Record<string, unknown>[]): number {
  const failureSignals = [
    "i don't know", "i do not know", "i'm not sure", "i am not sure",
    "i couldn't find", "i could not find", "i don't have that information",
    "i do not have that information", "i'm unable to", "i am unable to",
    "i can't help with that", "i cannot help with that", "unable to answer",
    "couldn't answer", "could not answer", "please contact our support team",
    "i don't have enough information", "i do not have enough information",
  ];
  const isAssistant = (m: Record<string, unknown>) => {
    const direction = String(m.direction || '').toUpperCase();
    const senderType = String(m.senderType || m.sender || m.role || '').toUpperCase();
    return direction === 'OUTBOUND' || ['AI', 'ASSISTANT', 'BOT'].includes(senderType);
  };
  let attempts = 0;
  for (const message of [...messages].reverse()) {
    if (!isAssistant(message)) continue;
    const body = String(message.text || message.body || message.content || '').toLocaleLowerCase();
    if (!body.trim()) continue;
    if (failureSignals.some((signal) => body.includes(signal))) attempts += 1;
    else break; // consecutive unsuccessful AI replies only
  }
  return attempts;
}
export function detectHumanHandoff(
  message: string,
  rules: HumanHandoffRules = {},
  context: { unsuccessfulAttempts?: number } = {},
): HumanHandoffMatch {
  // Built-in rules are independently controlled by their own switches. A legacy
  // top-level `enabled: false` must not silently disable the checked explicit-request rule.
  if (rules.explicitRequest === false && rules.frustration !== true && !(rules.customPhrases?.length)) return { matched: false };
  const normalized = normalizeHandoffText(message);
  if (!normalized) return { matched: false };

  // Do not let a quoted example or a conditional/hypothetical phrase trigger handoff.
  const negation = containsPhrase(normalized, NEGATED_REQUESTS);
  if (negation) return { matched: false };
  const quotedRequest = /(?:if i say|if i said|imagine i said|for example|the phrase|the words|you said|i said)\\s+.{0,90}\\b(?:talk|speak|connect|transfer)\\b.{0,70}\\b(?:human|person|agent|representative|support|manager|team)\\b/.test(normalized);
  if (quotedRequest) return { matched: false };

  if (rules.explicitRequest !== false) {
    const phrase = containsPhrase(normalized, EXPLICIT_REQUESTS);
    if (phrase) {
      // Avoid false positives where a customer reports someone else's request.
      const reportedSpeech = /^(?:my friend|my customer|the customer|someone|he|she|they)\\s+(?:said|asked|wants|wanted|needs|needed)\\b/.test(normalized);
      if (!reportedSpeech) return { matched: true, reason: 'EXPLICIT_REQUEST', matchedPhrase: phrase };
    }
  }
  if (rules.frustration === true) {
    const phrase = containsPhrase(normalized, FRUSTRATION);
    if (phrase) return { matched: true, reason: 'FRUSTRATION', matchedPhrase: phrase };
  }
  const custom = matchHumanHandoffKeyword(normalized, rules.customPhrases || []);
  return custom.matched ? custom : { matched: false };
}
