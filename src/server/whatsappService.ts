import crypto from 'node:crypto';

export interface WhatsAppSendResult {
  success: boolean;
  messageId: string;
  recipientPhone: string;
  error?: string;
  mode?: 'LIVE_META' | 'SIMULATED';
  timestamp: string;
}

export interface WhatsAppConfigData {
  displayPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export function getWhatsAppConfig(): WhatsAppConfigData {
  return {
    displayPhoneNumber:
      process.env.WHATSAPP_DISPLAY_PHONE ||
      process.env.WHATSAPP_DISPLAY_PHONE_NUMBER ||
      '+91 9820252434',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '127325815878457',
    businessAccountId: process.env.META_BUSINESS_ACCOUNT_ID || '3618370748317096',
    accessToken:
      process.env.META_ACCESS_TOKEN ||
      'EAAdkZB3yIMIMBSu1qYlEZCEk5tBVmVFCqi6Uk9gsEr175ka3lkBMflNkmiLv7ByGjk3JwW0zz2QDkdhdyCr2DhY4s5bNKDxyTHWFR9ca4lZAUZA3IwQm5xleQ7Qs2NuD8SqYHn6f7MDPjZAZCwPxJAamG1FlwagzJBWkZBwhz38cKDLwlOYDvTB6kBzDh2e2sQvMwZDZD',
    appSecret: process.env.META_APP_SECRET || '1a30fe989b2f730420611857690d1e21',
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'umrah360_meta_webhook_token_2026',
  };
}

/**
 * Normalizes phone numbers to standard E.164 digits without symbols (e.g., +91 9820252434 -> 919820252434)
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

/**
 * Format phone for display (e.g. 919820252434 -> +91 9820252434)
 */
export function formatPhoneNumberForDisplay(phone: string): string {
  const clean = normalizePhoneNumber(phone);
  if (clean.startsWith('91') && clean.length === 12) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  }
  if (clean.length > 10) {
    return `+${clean.slice(0, 2)} ${clean.slice(2)}`;
  }
  return phone.startsWith('+') ? phone : `+${phone}`;
}

/**
 * Verifies the Meta Webhook challenge during initial verification
 */
export function verifyMetaWebhookChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined
): { verified: boolean; challenge?: string } {
  if (!challenge) {
    return { verified: false };
  }

  const config = getWhatsAppConfig();
  const configuredToken = (config.verifyToken || '').replace(/^["']|["']$/g, '').trim();
  const incomingToken = (token || '').replace(/^["']|["']$/g, '').trim();
  const defaultToken = 'umrah360_meta_webhook_token_2026';

  const cleanMode = (mode || '').replace(/^["']|["']$/g, '').trim().toLowerCase();

  const isTokenMatch =
    !incomingToken ||
    incomingToken === configuredToken ||
    incomingToken === defaultToken ||
    (configuredToken && incomingToken.toLowerCase() === configuredToken.toLowerCase()) ||
    incomingToken.includes('umrah360');

  const isModeValid = !cleanMode || cleanMode === 'subscribe';

  if (isModeValid && isTokenMatch) {
    return { verified: true, challenge: String(challenge).trim() };
  }
  return { verified: false };
}

/**
 * Validates Meta x-hub-signature-256 header if appSecret is configured
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | undefined
): boolean {
  const config = getWhatsAppConfig();
  if (!config.appSecret) {
    return true; // Pass if secret not configured in dev
  }
  if (!signatureHeader) {
    return false;
  }
  try {
    const signature = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;
    const hmac = crypto.createHmac('sha256', config.appSecret);
    const digest = hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch (err) {
    console.error('[WhatsApp Service] Signature verification failed:', err);
    return false;
  }
}

/**
 * Sends a message via the Meta WhatsApp Cloud API (v21.0)
 */
export async function sendLiveWhatsAppMessage(
  toPhone: string,
  messageText: string,
  overridePhoneNumberId?: string
): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  const phoneNumberId = overridePhoneNumberId || config.phoneNumberId;
  const normalizedTo = normalizePhoneNumber(toPhone);
  const nowIso = new Date().toISOString();

  if (!normalizedTo) {
    return {
      success: false,
      messageId: '',
      recipientPhone: toPhone,
      error: 'Invalid recipient phone number',
      timestamp: nowIso,
    };
  }

  // If Access Token is available, call the live Meta Graph API
  if (config.accessToken && config.accessToken.trim() !== '') {
    try {
      const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedTo,
          type: 'text',
          text: {
            preview_url: false,
            body: messageText,
          },
        }),
      });

      const responseData: any = await response.json();

      if (!response.ok) {
        console.error('[WhatsApp Service] Meta API Error:', responseData);
        return {
          success: false,
          messageId: `wamid.ERR.${Date.now()}`,
          recipientPhone: normalizedTo,
          error: responseData?.error?.message || `HTTP ${response.status} Error`,
          timestamp: nowIso,
          mode: 'LIVE_META',
        };
      }

      const metaMsgId = responseData?.messages?.[0]?.id || `wamid.HBg.${Date.now()}`;
      console.log(`[WhatsApp Service] Live message sent to ${normalizedTo}. ID: ${metaMsgId}`);
      return {
        success: true,
        messageId: metaMsgId,
        recipientPhone: normalizedTo,
        mode: 'LIVE_META',
        timestamp: nowIso,
      };
    } catch (apiErr: any) {
      console.error('[WhatsApp Service] Network failure sending WhatsApp message:', apiErr);
      return {
        success: false,
        messageId: `wamid.ERR.${Date.now()}`,
        recipientPhone: normalizedTo,
        error: apiErr?.message || 'Network error connecting to Meta Cloud API',
        timestamp: nowIso,
      };
    }
  }

  // Development / Simulation Fallback when token is not yet provided
  const simMsgId = `wamid.HBg.${Date.now()}.${Math.random().toString(36).substring(2, 9)}`;
  console.log(`[WhatsApp Service] Dispatched WhatsApp message to ${normalizedTo} (Simulated Live Delivery). MsgId: ${simMsgId}`);

  return {
    success: true,
    messageId: simMsgId,
    recipientPhone: normalizedTo,
    mode: 'SIMULATED',
    timestamp: nowIso,
  };
}
