/**
 * One person, one thread: when a website form arrives for an email that already has a conversation
 * (typically from a direct email), the submission is added to that conversation and lead instead of
 * creating a second lead + conversation.
 */
import type { Conversation, Lead } from '../types/index.js';

/** Conversations in these states are finished; a new submission starts a fresh thread instead. */
const CLOSED_CONVERSATION_STATUSES = new Set(['RESOLVED', 'ARCHIVED']);

const time = (c: Partial<Conversation>): number =>
  new Date((c.lastMessageAt as string) || (c.updatedAt as string) || (c.createdAt as string) || 0).getTime() || 0;

/** Picks the most recently active, still-open conversation from candidates (deduplicated by id). */
export function pickReusableConversation(candidates: Array<Partial<Conversation> & { id?: string }>): (Partial<Conversation> & { conversationId: string }) | null {
  const seen = new Set<string>();
  const open: Array<Partial<Conversation> & { conversationId: string }> = [];
  for (const c of candidates) {
    const id = (c.conversationId || c.id) as string | undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (CLOSED_CONVERSATION_STATUSES.has(String(c.status || ''))) continue;
    open.push({ ...c, conversationId: id });
  }
  open.sort((a, b) => time(b) - time(a));
  return open[0] || null;
}

/** Fields the website form is allowed to refresh on an existing lead; everything else (status, owner, follow-up state...) is kept. */
const FORM_FIELDS: Array<keyof Lead> = [
  'serviceInterest', 'requirements', 'budget', 'timeline', 'aiSummary', 'aiRecommendation',
  'country', 'city', 'website', 'branches', 'teamSize', 'rawFormFields', 'productInterest', 'queryMessage', 'sourceUrl',
];

export function mergeWebsiteLead(fresh: Lead, existing: Partial<Lead> | null, nowIso: string): Lead {
  if (!existing) return fresh;
  const merged: Record<string, unknown> = { ...existing };
  for (const key of FORM_FIELDS) {
    const v = (fresh as any)[key];
    if (v !== undefined && v !== null && v !== '') merged[key] = v;
  }
  merged.leadId = existing.leadId || fresh.leadId;
  merged.contactId = existing.contactId || fresh.contactId;
  merged.leadType = existing.leadType || 'INBOUND';
  merged.leadScore = Math.max(Number(existing.leadScore) || 0, Number(fresh.leadScore) || 0);
  const oldNotes = String(existing.notes || '').trim();
  const newNotes = String(fresh.notes || '').trim();
  merged.notes = newNotes && !oldNotes.includes(newNotes) ? [oldNotes, `Website form (${nowIso.slice(0, 10)}): ${newNotes}`].filter(Boolean).join('\n') : oldNotes;
  merged.createdAt = existing.createdAt || fresh.createdAt;
  merged.updatedAt = nowIso;
  merged.lastActivityAt = nowIso;
  return merged as unknown as Lead;
}

/** Adds the form submission to an existing conversation without changing its channel, AI or handoff state. */
export function mergeWebsiteConversation(fresh: Conversation, existing: Partial<Conversation>, nowIso: string): Conversation {
  const { id: _ignored, ...rest } = existing as any;
  return {
    ...rest,
    conversationId: existing.conversationId as string,
    customerEmail: fresh.customerEmail,
    // thank-you bookkeeping comes from this submission (it decides whether a thank-you still has to go out)
    thankYouEmailSent: Boolean(existing.thankYouEmailSent) || fresh.thankYouEmailSent,
    thankYouEmailSuppressed: Boolean(fresh.thankYouEmailSuppressed),
    thankYouSmtpMessageId: existing.thankYouSmtpMessageId || fresh.thankYouSmtpMessageId,
    lastMessageAt: nowIso,
    lastMessageText: fresh.lastMessageText,
    unreadCount: (Number(existing.unreadCount) || 0) + 1,
    isRead: false,
    unread: true,
    updatedAt: nowIso,
  } as Conversation;
}
