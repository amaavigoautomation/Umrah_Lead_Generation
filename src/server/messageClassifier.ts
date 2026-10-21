import OpenAI from "openai";

export interface ClassificationParams {
  subject?: string;
  body: string;
  from?: string;
  channel?: string;
  companyName?: string;
  /**
   * True when this message continues an existing conversation (a reply in a thread). Replies such as
   * "yes", "ok" or "send the details" carry no topic keywords, so they must not be dropped as unrelated.
   * Bot / newsletter checks still apply.
   */
  isFollowUp?: boolean;
}

export interface ClassificationResult {
  qualifies: boolean;
  reason: string;
  isBotOrNewsletter: boolean;
}

/**
 * Robust regex-based filter to detect bots, auto-replies, bounces, and newsletters.
 * Strip URLs/HTML tags first to avoid matching keywords embedded within query parameters.
 */
export function classifyInboundMessageFallback(params: ClassificationParams): ClassificationResult {
  const from = (params.from || "").toLowerCase().trim();
  const subject = (params.subject || "").toLowerCase().trim();
  const body = (params.body || "").toLowerCase().trim();

  // 1. Blocklist of well-known automated, social, and promotional sender domains
  const emailDomain = from.includes("@") ? from.split("@")[1] : "";
  const blockedDomains = [
    "pinterest.com",
    "discover.pinterest.com",
    "pmail.pinterest.com",
    "linkedin.com",
    "messages-noreply.linkedin.com",
    "facebookmail.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "quora.com",
    "redditmail.com",
    "reddit.com",
    "tumblr.com",
    "canva.com",
    "medium.com",
    "apollo.io",
    "hubspotmail.com",
    "hubspot.com",
    "salesforce.com"
  ];
  
  const isBlockedDomain = blockedDomains.some(
    dom => emailDomain === dom || emailDomain.endsWith("." + dom)
  );

  if (isBlockedDomain) {
    return {
      qualifies: false,
      reason: `Sender domain (${emailDomain}) belongs to a blocked automated/social platform`,
      isBotOrNewsletter: true,
    };
  }

  // 2. Detect automated sender prefixes/local parts
  const automatedPrefixes = [
    "no-reply", "noreply", "mailer-daemon", "postmaster", "newsletter", "bounce", 
    "alerts", "notifications", "notification", "system", "bot", "auto-reply", 
    "recommendations", "update", "updates", "digest", "digests", "promotions", 
    "marketing", "feedback", "survey", "info@discover", "reply-to"
  ];
  const fromLocalPart = from.includes("@") ? from.split("@")[0] : from;
  const isAutoPrefix = automatedPrefixes.some(prefix => 
    fromLocalPart.includes(prefix) || fromLocalPart.startsWith(prefix)
  );

  if (isAutoPrefix) {
    return {
      qualifies: false,
      reason: `Sender local part (${fromLocalPart}) flagged as automated prefix`,
      isBotOrNewsletter: true,
    };
  }

  // 3. Detect typical bot/auto-reply subject lines and templates
  const isAutoSubject =
    subject.includes("out of office") ||
    subject.includes("auto-reply") ||
    subject.includes("auto reply") ||
    subject.includes("delivery status") ||
    subject.includes("undelivered mail") ||
    subject.includes("failure notice") ||
    subject.includes("returned mail") ||
    subject.includes("vacation response") ||
    subject.includes("unsubscribe") ||
    subject.includes("mail delivery") ||
    subject.includes("automatic reply") ||
    subject.includes("inspired by your") ||
    subject.includes("recommended for you") ||
    subject.includes("new pins") ||
    subject.includes("verification code") ||
    subject.includes("one-time password") ||
    subject.includes("otp");

  if (isAutoSubject) {
    return {
      qualifies: false,
      reason: "Subject flagged as automated notification, bounce, or social digest",
      isBotOrNewsletter: true,
    };
  }

  // 4. Strip URLs and HTML tags from body before content check to prevent false-matching inside URLs
  const cleanBodyText = body
    .replace(/https?:\/\/[^\s]+/g, "") // Remove standard http/https links
    .replace(/www\.[^\s]+/g, "")       // Remove www links
    .replace(/<[^>]*>/g, "")           // Remove HTML tags
    .replace(/\s+/g, " ")              // Normalize spaces
    .trim();

  // 5. Rich automated template phrase matching in clean body text
  const isNewsletterBody =
    cleanBodyText.includes("unsubscribe") ||
    cleanBodyText.includes("un-subscribe") ||
    cleanBodyText.includes("view in browser") ||
    cleanBodyText.includes("manage your preferences") ||
    cleanBodyText.includes("manage preferences") ||
    cleanBodyText.includes("email preferences") ||
    cleanBodyText.includes("you are receiving this email") ||
    cleanBodyText.includes("received this email because") ||
    cleanBodyText.includes("opt-out") ||
    cleanBodyText.includes("opt out") ||
    cleanBodyText.includes("mailing list") ||
    cleanBodyText.includes("add us to your address") ||
    cleanBodyText.includes("all rights reserved") ||
    cleanBodyText.includes("copyright") ||
    cleanBodyText.includes("to view this content, open the following url") ||
    cleanBodyText.includes("open the following url in your browser") ||
    cleanBodyText.includes("having trouble viewing this email") ||
    cleanBodyText.includes("this is an automated message") ||
    cleanBodyText.includes("please do not reply to this email") ||
    cleanBodyText.includes("do not reply to this email") ||
    (cleanBodyText.includes("privacy policy") && (cleanBodyText.includes("terms of service") || cleanBodyText.includes("terms & conditions") || cleanBodyText.includes("terms and conditions")));

  if (isNewsletterBody) {
    return {
      qualifies: false,
      reason: "Message body matched automated transactional, newsletter, or promotional footer template",
      isBotOrNewsletter: true,
    };
  }

  // 6. Basic topic check on remaining clean body (about company, product, booking, enquiry, interest, issue)
  const hasRelevanceKeywords =
    cleanBodyText.includes("b2b") ||
    cleanBodyText.includes("b2c") ||
    cleanBodyText.includes("portal") ||
    cleanBodyText.includes("cost") ||
    cleanBodyText.includes("pricing") ||
    cleanBodyText.includes("package") ||
    cleanBodyText.includes("software") ||
    cleanBodyText.includes("platform") ||
    cleanBodyText.includes("booking") ||
    cleanBodyText.includes("enquiry") ||
    cleanBodyText.includes("inquiry") ||
    cleanBodyText.includes("issue") ||
    cleanBodyText.includes("problem") ||
    cleanBodyText.includes("error") ||
    cleanBodyText.includes("demo") ||
    cleanBodyText.includes("interested") ||
    cleanBodyText.includes("help") ||
    cleanBodyText.includes("question") ||
    cleanBodyText.includes("contact") ||
    cleanBodyText.includes("support") ||
    cleanBodyText.includes("sales") ||
    cleanBodyText.includes("business") ||
    cleanBodyText.includes("client") ||
    cleanBodyText.includes("service") ||
    cleanBodyText.includes("product") ||
    cleanBodyText.includes("account") ||
    cleanBodyText.includes("integration") ||
    cleanBodyText.includes("partner");

  if (hasRelevanceKeywords) {
    return {
      qualifies: true,
      reason: "Message has relevant industry or enquiry keywords",
      isBotOrNewsletter: false,
    };
  }

  // Replies inside an existing conversation, and chat-style channels (WhatsApp/Instagram: a human on the
  // other end, often a short "Hi"), are not judged by topic keywords. Only emails starting a new thread are.
  const channel = (params.channel || "").toUpperCase();
  if (params.isFollowUp || (channel && channel !== "EMAIL")) {
    return {
      qualifies: true,
      reason: params.isFollowUp ? "Reply within an existing conversation" : "Direct message on a chat channel",
      isBotOrNewsletter: false,
    };
  }

  // If none of the relevant keywords are present, default to unqualified but not bot
  return {
    qualifies: false,
    reason: "Message is completely unrelated to our company, products, or services",
    isBotOrNewsletter: false,
  };
}

/**
 * Classifies an inbound message using robust pre-checks first (fail-fast),
 * then falls back to OpenAI API for cognitive analysis on high-confidence messages.
 */
export async function classifyInboundMessage(params: ClassificationParams): Promise<ClassificationResult> {
  const openAiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const targetCompany = params.companyName || "the company";

  // Run the super robust deterministic checks first to fail-fast.
  // This avoids calling OpenAI/LLMs for obvious automated recommendations,
  // newsletters, social notifications, or bounces, saving costs and latency.
  const deterministicResult = classifyInboundMessageFallback(params);
  
  if (deterministicResult.isBotOrNewsletter || !deterministicResult.qualifies) {
    console.log(`[Deterministic Pre-Check] Inbound classified immediately: qualifies=${deterministicResult.qualifies}, reason="${deterministicResult.reason}"`);
    return deterministicResult;
  }

  // Only proceed to OpenAI if the message passed all deterministic checks
  if (openAiKey) {
    try {
      const openai = new OpenAI({ apiKey: openAiKey });
      
      const systemInstruction = `You are a strict, highly accurate message classifier for a multi-tenant business communication platform (current company context: "${targetCompany}").
Your task is to analyze an incoming message from a customer/user across channels like Email, WhatsApp, and Instagram, and determine if it qualifies for an automated AI reply.

You must classify the message into one of two decisions:
1. QUALIFIED: The message is a genuine, human-written message about our company/product/services, a general business inquiry, partnership enquiry, someone facing an issue/error, or someone expressing interest or asking a relevant business question.
2. IGNORED: The message is a bot-generated message, an automated system notification (e.g., mail delivery bounce, postmaster alert, auto-reply, out-of-office message), a mass marketing newsletter/advertisement/spam, or a conversation completely unrelated to our company/product/services.

Guidelines:
- If it is a bot message, automated bounce, out-of-office response, or newsletter, you MUST set "qualifies" to false and "isBotOrNewsletter" to true.
- If it is about the company/product/services, asks an enquiry, reports a problem/issue, or shows interest/curiosity, you MUST set "qualifies" to true and "isBotOrNewsletter" to false.
- Do NOT hardcode specific keywords. Look at the semantic meaning of the message.
- You must respond with a JSON object containing EXACTLY:
  {
    "qualifies": boolean,
    "reason": "A concise, clear explanation of why it qualifies or is ignored",
    "isBotOrNewsletter": boolean
  }`;

      const prompt = `INCOMING MESSAGE DETAILS:
From/Sender: ${params.from || "Unknown"}
Channel: ${params.channel || "Unknown"}
Subject: ${params.subject || "No Subject"}
Message Body:
"""
${params.body}
"""`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content.trim()) as ClassificationResult;
        console.log(`[OpenAI Classifier] Inbound classified: qualifies=${parsed.qualifies}, reason="${parsed.reason}"`);
        return parsed;
      }
    } catch (err: any) {
      console.warn("[OpenAI Classifier] Warning during classification, falling back to deterministic:", err?.message || err);
    }
  }

  console.log(`[Pre-Check Fallback] Inbound classified: qualifies=${deterministicResult.qualifies}, reason="${deterministicResult.reason}"`);
  return deterministicResult;
}
