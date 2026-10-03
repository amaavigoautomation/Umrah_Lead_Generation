import { collection, doc, getDocs, query, setDoc, where, limit } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import { verifyResendWebhookSignature } from './resendService.js';
import { addSuppression, GLOBAL_SCOPE } from './emailSuppression.js';
import { applyDeliveryFailureToMemory } from './campaignService.js';

/**
 * Handles Resend webhook deliveries (configure in Resend → Webhooks → https://<your-app>/api/webhooks/resend,
 * events: email.bounced, email.complained, optionally email.delivered / email.delivery_delayed).
 *
 * - Hard bounces and spam complaints are suppressed for EVERY client (they hurt the shared Resend account's reputation).
 * - The matching campaign lead (looked up by the Resend email id we stored when sending) is marked FAILED.
 */

function toArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v) return [v];
  return [];
}

function extractAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export async function handleResendWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): Promise<{ status: number; body: Record<string, any> }> {
  const secret = (process.env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    return { status: 503, body: { error: 'RESEND_WEBHOOK_SECRET is not configured on the server.' } };
  }
  if (!verifyResendWebhookSignature(rawBody, headers, secret)) {
    return { status: 401, body: { error: 'Invalid webhook signature.' } };
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON payload.' } };
  }

  const type: string = event?.type || '';
  const data = event?.data || {};
  const emailId: string = data.email_id || data.id || '';
  const recipients = toArray(data.to).map(extractAddress);

  try {
    if (type === 'email.bounced' || type === 'email.complained') {
      const isBounce = type === 'email.bounced';
      // Transient bounces (mailbox full etc.) are not permanent — only suppress hard bounces.
      const bounceType = String(data.bounce?.type || data.bounce?.subType || '').toLowerCase();
      const permanent = !isBounce || bounceType === '' || bounceType.includes('permanent');

      const reason = isBounce
        ? `Bounced${data.bounce?.message ? `: ${String(data.bounce.message).slice(0, 200)}` : ''}`
        : 'Recipient marked the email as spam';

      if (permanent) {
        for (const email of recipients) {
          await addSuppression({
            clientId: GLOBAL_SCOPE,
            email,
            reason: isBounce ? 'bounced' : 'complained',
            source: `resend:${emailId || type}`,
          });
        }
      }

      if (emailId) {
        applyDeliveryFailureToMemory(emailId, reason);
        if (isFirebaseConfigured && db) {
          const snap = await getDocs(query(collection(db, 'campaign_leads'), where('gmailMessageId', '==', emailId), limit(5)));
          const now = new Date().toISOString();
          for (const d of snap.docs) {
            await setDoc(
              doc(db, 'campaign_leads', d.id),
              sanitizeForFirestore({ sendStatus: 'FAILED', lastError: reason, updatedAt: now }),
              { merge: true }
            );
          }
        }
      }
      console.log(`[Resend Webhook] ${type} for ${recipients.join(', ') || emailId} (${permanent ? 'suppressed' : 'soft bounce, not suppressed'})`);
    }
    // email.delivered / email.opened / email.clicked / email.delivery_delayed are acknowledged and ignored.
  } catch (err: any) {
    console.error('[Resend Webhook] Handler error:', err);
    // Non-2xx makes Resend retry the delivery.
    return { status: 500, body: { error: err?.message || 'Webhook handler failed' } };
  }

  return { status: 200, body: { received: true, type } };
}
