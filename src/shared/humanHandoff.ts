/**
 * Deterministic Human Handoff detection shared by every inbound channel (email, WhatsApp,
 * Instagram, Messenger).
 *
 * Detection works clause by clause so that "I don't want a bot, I want a human" still hands off,
 * while "I don't want to talk to a human" does not. Each built-in rule is controlled by its own
 * switch and defaults to ON unless it is explicitly set to `false`.
 */
export type HumanHandoffReason = 'EXPLICIT_REQUEST' | 'FRUSTRATION' | 'AI_UNRESOLVED' | 'CUSTOM_PHRASE';

export interface HumanHandoffMatch {
  matched: boolean;
  reason?: HumanHandoffReason;
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

/**
 * Lowercases, removes apostrophes ("don't" -> "dont") and collapses everything that is not a
 * letter or digit into single spaces. Removing apostrophes (instead of turning them into spaces)
 * keeps contractions in one piece so negations like "i don't want a human" are recognised.
 */
export function normalizeHandoffText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsPhrase(text: string, phrases: readonly string[]): string | undefined {
  const padded = ` ${normalizeHandoffText(text)} `;
  return phrases.find((phrase) => {
    const normalized = normalizeHandoffText(phrase);
    return Boolean(normalized && padded.includes(` ${normalized} `));
  });
}

// ---------------------------------------------------------------------------
// Phrase lists (matched on whole words after normalisation)
// ---------------------------------------------------------------------------
const EXPLICIT_REQUESTS = [
  'talk to a human', 'speak to a human', 'talk with a human', 'speak with a human',
  'talk to a real person', 'speak to a real person', 'talk with a real person', 'speak with a real person',
  'i want a human', 'i need a human', 'i need a real person', 'i want a real person',
  'let me talk to a person', 'let me speak to a person', 'can i talk to a person', 'can i speak to a person',
  'connect me to a person', 'connect me with a person', 'connect me to someone', 'connect me with someone',
  'human agent', 'live agent', 'real agent', 'actual person', 'real person please', 'live person',
  'human representative', 'real representative', 'live representative',
  'customer service agent', 'customer support representative',
  'connect me with a human', 'connect me to a human', 'connect me to an agent', 'connect me with an agent',
  'transfer me to a human', 'transfer me to an agent', 'transfer me to support',
  'put me through to an agent', 'put me through to a person', 'operator please', 'agent please',
  'human support', 'i want human assistance', 'i need human assistance', 'human assistance',
  'stop the bot', 'stop talking like a bot', 'stop being a bot', 'no more bot',
  'i want to talk to your team', 'i need to talk to your team', 'can someone from your team help me',
  'can a person help me', 'let me speak to a manager', 'i want a supervisor', 'get me your manager',
  'call me back', 'please call me', 'have someone call me', 'i need someone to call me',
  'please have a person contact me', 'have your team contact me', 'contact me through a person',
  'real human', 'actual human', 'human being',
];

const NEGATED_REQUESTS = [
  'do not connect me to a human', 'dont connect me to a human', 'do not transfer me', 'dont transfer me',
  'i do not want a human', 'i dont want a human', 'i do not want to speak to a human',
  'i dont want to speak to a human', 'i do not want to talk to a human', 'i dont want to talk to a human',
  'i do not need a human', 'i dont need a human', 'no human needed', 'no need for a human',
  'no need to transfer me', 'do not call me back', 'dont call me back', 'do not connect me to an agent',
  'dont connect me to an agent', 'i do not want an agent', 'i dont want an agent', 'i do not need an agent',
  'i dont need an agent', 'i can handle this myself', 'i will continue with the bot',
  'keep helping me here', 'just answer my question', 'answer me directly instead of transferring me',
  'no need to call', 'dont call me', 'do not call me',
];

const FRUSTRATION = [
  'you are not understanding me', 'you dont understand', 'you do not understand', 'this is not helping',
  'this isnt helping', 'not helpful at all', 'i already explained this', 'i have explained this',
  'i told you already', 'same question again', 'this is frustrating', 'i am frustrated', 'im frustrated',
  'very disappointed', 'this is unacceptable', 'i want to speak to your manager', 'stop wasting my time',
  'you keep repeating yourself', 'you are repeating yourself', 'you are useless', 'this is useless',
];

// ---------------------------------------------------------------------------
// Pattern rules (run on the normalised clause)
// ---------------------------------------------------------------------------
const TARGET =
  '(?:humans?|persons?|people|agents?|representatives?|reps?|managers?|supervisors?|executives?|advis[eo]rs?|' +
  'consultants?|specialists?|experts?|operators?|staff|employees?|someone|somebody|anyone|anybody|owner|director|' +
  'senior|sales|support|customer (?:service|care|support)|help ?desk|team|team members?)';
// "support page", "sales brochure" etc. are not a person.
const NOT_A_PAGE = '(?!\\s+(?:page|pages|article|articles|docs|documentation|portal|centre|center|form|link|site|website|email|number|ticket|tickets|brochure|deck|pricing|price|prices))';
const MODIFIERS = '(?:\\w+\\s+){0,3}?';

const EXPLICIT_PATTERNS: RegExp[] = [
  // "talk to / speak with / chat to (the booking) team|agent|manager|someone..."
  new RegExp(`\\b(?:talk|speak|chat|get in touch|be in touch)\\s+(?:to|with)\\s+${MODIFIERS}${TARGET}\\b${NOT_A_PAGE}`),
  // "connect/transfer/forward/escalate/put/get ... me|this ... to|with|through ... agent|manager..."
  new RegExp(`\\b(?:connect|transfer|forward|escalate|route|redirect|refer|pass|hand|put|bring|get|link)\\s+(?:\\w+\\s+){0,3}?(?:to|with|through|over to)\\s+${MODIFIERS}${TARGET}\\b${NOT_A_PAGE}`),
  // "have/get/let someone call|contact|help me"
  /\b(?:have|get|let)\s+(?:someone|somebody|a person|a human|an agent|a representative|your team|the team|one of your \w+|a member of your team)\s+(?:to\s+)?(?:call|contact|reach|ring|phone|get back to|help|assist)\b/,
  // call-back requests
  // Question/imperative forms only, so "you can call me Sahil" is not a request.
  /\b(?:can|could|would|will)\s+(?:you|u|someone|somebody|anyone|anybody|your team|the team)\b(?:\s+\w+){0,2}\s+(?:call|ring|phone)\s+me\b/,
  /\bplease\b(?:\s+\w+){0,3}\s+(?:call|ring|phone)\s+me\b/,
  /\b(?:call|ring|phone)\s+me\s+(?:back|please|asap|today|tomorrow|tonight|now|soon|later|anytime|when|on|at)\b/,
  /\bgive\s+me\s+a\s+(?:call|ring)\b/,
  /\b(?:call ?back|callback|call back)\b/,
  // "is there someone I can talk to", "is there a human available"
  new RegExp(`\\bis\\s+there\\s+(?:a|an|any)?\\s*${TARGET}\\b(?:\\s+\\w+){0,4}?\\s+(?:available|talk|speak|help|call|there|around|who can|i can)\\b`),
  // explicit escalation
  /\bescalat(?:e|ed|ion|ing)\b/,
];

const FRUSTRATION_PATTERNS: RegExp[] = [
  /\b(?:file|make|lodge|raise|register)\s+(?:a\s+)?complaint\b/,
  /\bnot\s+(?:listening|helping|understanding)\b/,
  /\bwaste\s+of\s+(?:my\s+)?time\b/,
  /\bworst\s+(?:service|support|experience|bot)\b/,
  /\b(?:fed up|sick of|tired of)\b/,
  /\b(?:useless|pathetic|worthless|ridiculous)\b/,
  /\byou\s+(?:keep|are)\s+(?:repeating|looping|ignoring)\b/,
];

// Negation reaches only a few words ahead so a later, separate request is not swallowed.
const NEGATION_PATTERN =
  /\b(?:do not|dont|doesnt|no need to|no need for|not looking to|never|without)\s+(?:\w+\s+){0,3}?(?:talk|speak|chat|connect|transfer|call|escalate|human|person|agent|representative|manager|someone|somebody)\b/;
const QUOTED_PATTERN =
  /(?:if i say|if i said|imagine i said|for example|the phrase|the words|you said|i said)\s+.{0,90}\b(?:talk|speak|connect|transfer)\b.{0,70}\b(?:human|person|agent|representative|support|manager|team)\b/;
const REPORTED_PATTERN =
  /^(?:my friend|my customer|the customer|someone|he|she|they)\s+(?:said|asked|wants|wanted|needs|needed)\b/;

function splitClauses(message: string): string[] {
  return String(message || '')
    .toLocaleLowerCase()
    .split(/[.!?;\n\r]+|,|\s(?:but|however|although|though|and then)\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function matchExplicit(normalized: string): string | undefined {
  const phrase = containsPhrase(normalized, EXPLICIT_REQUESTS);
  if (phrase) return phrase;
  for (const pattern of EXPLICIT_PATTERNS) {
    const m = pattern.exec(normalized);
    if (m) return m[0].trim();
  }
  return undefined;
}

function matchFrustration(normalized: string): string | undefined {
  const phrase = containsPhrase(normalized, FRUSTRATION);
  if (phrase) return phrase;
  for (const pattern of FRUSTRATION_PATTERNS) {
    const m = pattern.exec(normalized);
    if (m) return m[0].trim();
  }
  return undefined;
}

function isNegated(normalized: string): boolean {
  return Boolean(containsPhrase(normalized, NEGATED_REQUESTS)) || NEGATION_PATTERN.test(normalized);
}

export function matchHumanHandoffKeyword(message: string, configuredPhrases: readonly string[] = []): HumanHandoffMatch {
  const matchedPhrase = containsPhrase(message, configuredPhrases);
  return matchedPhrase ? { matched: true, reason: 'CUSTOM_PHRASE', matchedPhrase: matchedPhrase.trim() } : { matched: false };
}

/**
 * Counts consecutive recent AI replies that explicitly admit they could not resolve the request.
 * The inbound pipelines pass prior thread messages here before generating a new reply.
 */
export function countUnsuccessfulResolutionAttempts(messages: readonly Record<string, unknown>[]): number {
  const failureSignals = [
    "i don't know", 'i do not know', "i'm not sure", 'i am not sure',
    "i couldn't find", 'i could not find', "i don't have that information",
    'i do not have that information', "i'm unable to", 'i am unable to',
    "i can't help with that", 'i cannot help with that', 'unable to answer',
    "couldn't answer", 'could not answer', 'please contact our support team',
    "i don't have enough information", 'i do not have enough information',
    "i don't have details", 'i do not have details', "i'm not able to", 'i am not able to',
    'our team will get back to you', 'a team member will follow up',
  ];
  const isAssistant = (m: Record<string, unknown>) => {
    const direction = String(m.direction || '').toUpperCase();
    const senderType = String(m.senderType || m.sender || m.role || '').toUpperCase();
    return direction === 'OUTBOUND' || ['AI', 'ASSISTANT', 'BOT'].includes(senderType);
  };
  let attempts = 0;
  for (const message of [...messages].reverse()) {
    if (!isAssistant(message)) continue;
    const body = String(message.text || message.body || message.content || '')
      .toLocaleLowerCase()
      .replace(/[’‘]/g, "'");
    if (!body.trim()) continue;
    if (failureSignals.some((signal) => body.includes(signal))) attempts += 1;
    else break; // consecutive unsuccessful AI replies only
  }
  return attempts;
}

export function detectHumanHandoff(
  message: string,
  rules: HumanHandoffRules = {},
  _context: { unsuccessfulAttempts?: number } = {},
): HumanHandoffMatch {
  // Every built-in rule has its own switch and is on unless explicitly false.
  // A legacy top-level `enabled: false` must not silently disable the other rules.
  const explicitOn = rules.explicitRequest !== false;
  const frustrationOn = rules.frustration !== false;
  const customPhrases = rules.customPhrases || [];

  const whole = normalizeHandoffText(message);
  if (!whole) return { matched: false };

  // A quoted example or a hypothetical ("if I say talk to a human...") is not a request.
  if (!QUOTED_PATTERN.test(whole)) {
    for (const clause of splitClauses(message)) {
      const normalized = normalizeHandoffText(clause);
      if (!normalized) continue;
      if (isNegated(normalized)) continue;
      if (REPORTED_PATTERN.test(normalized)) continue; // a customer reporting someone else's request

      if (explicitOn) {
        const phrase = matchExplicit(normalized);
        if (phrase) return { matched: true, reason: 'EXPLICIT_REQUEST', matchedPhrase: phrase };
      }
      if (frustrationOn) {
        const phrase = matchFrustration(normalized);
        if (phrase) return { matched: true, reason: 'FRUSTRATION', matchedPhrase: phrase };
      }
      const custom = matchHumanHandoffKeyword(normalized, customPhrases);
      if (custom.matched) return custom;
    }
  }

  // Note: the "AI could not resolve the request N times" trigger was retired on purpose (see commit b6a5522);
  // `aiUnableToResolve` / `failureThreshold` are still accepted so saved settings keep loading, but they do not trigger.
  return { matched: false };
}
