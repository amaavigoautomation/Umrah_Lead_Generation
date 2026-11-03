export interface InboundEmailIgnoreRules {
  ignoreNewsletters: boolean;
  ignoreAutomatedEmails: boolean;
  ignoreGoogleNotifications: boolean;
  ignoredSenders: string[];
  ignoredDomains: string[];
  ignoredSubjectKeywords: string[];
  allowedSenders: string[];
  allowedDomains: string[];
}

export const DEFAULT_INBOUND_EMAIL_IGNORE_RULES: InboundEmailIgnoreRules = {
  ignoreNewsletters: true,
  ignoreAutomatedEmails: true,
  ignoreGoogleNotifications: true,
  ignoredSenders: [],
  ignoredDomains: [],
  ignoredSubjectKeywords: [],
  allowedSenders: [],
  allowedDomains: [],
};

const GOOGLE_DOMAINS = ['google.com', 'googlemail.com', 'googleusercontent.com'];
const AUTOMATED_SENDER_MARKERS = [
  'no-reply', 'noreply', 'donotreply', 'mailer-daemon', 'postmaster',
  'googleaistudio-noreply', 'firebase-no-reply', 'security-noreply',
];
const NEWSLETTER_SENDER_MARKERS = [
  'facebookmail.com', 'business-updates.facebook.com', 'redditmail.com', 'quora.com',
  'linkedin.com', 'twitter.com', 'x.com', 'medium.com', 'substack.com', 'mailchimp',
];
const AUTOMATED_SUBJECT_MARKERS = [
  'security alert', 'delivery status notification', 'mail delivery subsystem',
  'verification code', 'action needed on your meta account', 'daily notification',
];
const NEWSLETTER_SUBJECT_MARKERS = [
  'newsletter', 'weekly digest', 'daily digest', 'weekly snapshot', 'product update',
  'free trial of', 'search performance', 'welcome to ',
];

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))].slice(0, 100);
}

export function normalizeInboundEmailIgnoreRules(value?: Partial<InboundEmailIgnoreRules> | null): InboundEmailIgnoreRules {
  const input = value || {};
  return {
    ignoreNewsletters: typeof input.ignoreNewsletters === 'boolean'
      ? input.ignoreNewsletters : DEFAULT_INBOUND_EMAIL_IGNORE_RULES.ignoreNewsletters,
    ignoreAutomatedEmails: typeof input.ignoreAutomatedEmails === 'boolean'
      ? input.ignoreAutomatedEmails : DEFAULT_INBOUND_EMAIL_IGNORE_RULES.ignoreAutomatedEmails,
    ignoreGoogleNotifications: typeof input.ignoreGoogleNotifications === 'boolean'
      ? input.ignoreGoogleNotifications : DEFAULT_INBOUND_EMAIL_IGNORE_RULES.ignoreGoogleNotifications,
    ignoredSenders: cleanList(input.ignoredSenders),
    ignoredDomains: cleanList(input.ignoredDomains),
    ignoredSubjectKeywords: cleanList(input.ignoredSubjectKeywords),
    allowedSenders: cleanList(input.allowedSenders),
    allowedDomains: cleanList(input.allowedDomains),
  };
}

function senderDomain(address: string): string {
  const at = String(address || '').toLowerCase().lastIndexOf('@');
  return at >= 0 ? String(address).slice(at + 1).trim().toLowerCase() : '';
}

function domainMatches(address: string, configuredDomain: string): boolean {
  const domain = senderDomain(address);
  const candidate = String(configuredDomain || '').toLowerCase().replace(/^@/, '').trim();
  return Boolean(domain && candidate && (domain === candidate || domain.endsWith('.' + candidate)));
}

function isAllowed(address: string, rules: InboundEmailIgnoreRules): boolean {
  const from = String(address || '').trim().toLowerCase();
  if (!from) return false;
  return rules.allowedSenders.includes(from) ||
    rules.allowedDomains.some((domain) => domainMatches(from, domain));
}

function includesAny(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

/** Returns a reason when a sender/subject matches tenant ignore rules. Allow rules always win. */
export function getInboundIgnoreReason(
  fromAddress: string,
  subject: string,
  configuredRules?: Partial<InboundEmailIgnoreRules> | null
): string | undefined {
  const rules = normalizeInboundEmailIgnoreRules(configuredRules);
  const from = String(fromAddress || '').trim().toLowerCase();
  const subj = String(subject || '').toLowerCase();
  if (isAllowed(from, rules)) return undefined;

  if (rules.ignoredSenders.includes(from)) return 'Sender is on this workspace’s ignore list';
  if (rules.ignoredDomains.some((domain) => domainMatches(from, domain))) return 'Sender domain is on this workspace’s ignore list';

  if (rules.ignoredSubjectKeywords.some((keyword) => subj.includes(keyword))) {
    return 'Subject matched a workspace ignore keyword';
  }

  // Google is its own explicit category. Turning it off allows Google senders through even if they use no-reply headers.
  const isGoogleSender = GOOGLE_DOMAINS.some((domain) => domainMatches(from, domain));
  if (isGoogleSender) {
    return rules.ignoreGoogleNotifications ? 'Google notifications are ignored by workspace settings' : undefined;
  }

  if (rules.ignoreAutomatedEmails && includesAny(from, AUTOMATED_SENDER_MARKERS)) {
    return 'Automated sender ignored by workspace settings';
  }
  if (rules.ignoreAutomatedEmails && includesAny(subj, AUTOMATED_SUBJECT_MARKERS)) {
    return 'Automated notification ignored by workspace settings';
  }
  if (rules.ignoreNewsletters && includesAny(from, NEWSLETTER_SENDER_MARKERS)) {
    return 'Newsletter / promotional sender ignored by workspace settings';
  }
  if (rules.ignoreNewsletters && includesAny(subj, NEWSLETTER_SUBJECT_MARKERS)) {
    return 'Newsletter / promotional subject ignored by workspace settings';
  }
  return undefined;
}

/** Applies bulk/automation headers after the message body is parsed; allow-list still has priority. */
export function getInboundHeaderIgnoreReason(
  fromAddress: string,
  headers: { get?: (name: string) => unknown } | undefined,
  xMailer: unknown,
  configuredRules?: Partial<InboundEmailIgnoreRules> | null
): string | undefined {
  const rules = normalizeInboundEmailIgnoreRules(configuredRules);
  const from = String(fromAddress || '').trim().toLowerCase();
  if (isAllowed(from, rules)) return undefined;

  // Always suppress a message generated by this platform, even when tenant filters are relaxed.
  if (String(xMailer || '') === 'Umrah360-AI-Automated-Platform') return 'Platform-generated email';

  const isGoogleSender = GOOGLE_DOMAINS.some((domain) => domainMatches(from, domain));
  if (isGoogleSender) {
    return rules.ignoreGoogleNotifications ? 'Google notifications are ignored by workspace settings' : undefined;
  }
  const autoSubmitted = String(headers?.get?.('auto-submitted') || '').trim().toLowerCase();
  const automatedBy = String(headers?.get?.('x-automated-by') || '').trim();
  const precedence = String(headers?.get?.('precedence') || '').trim().toLowerCase();
  const hasListUnsubscribe = Boolean(headers?.get?.('list-unsubscribe'));

  if (rules.ignoreAutomatedEmails && (automatedBy || (autoSubmitted && autoSubmitted !== 'no'))) {
    return 'Automated email header ignored by workspace settings';
  }
  if (rules.ignoreNewsletters && (['bulk', 'junk', 'list'].includes(precedence) || hasListUnsubscribe)) {
    return 'Newsletter / bulk email headers ignored by workspace settings';
  }
  return undefined;
}
