import OpenAI from "openai";

export interface ClassificationParams {
  subject?: string;
  body: string;
  from?: string;
  channel?: string;
  companyName?: string;
}

export interface ClassificationResult {
  qualifies: boolean;
  reason: string;
  isBotOrNewsletter: boolean;
}

/**
 * Robust regex-based fallback filter to detect bots, auto-replies, bounces, and newsletters
 * if the OpenAI model is unavailable or fails.
 */
export function classifyInboundMessageFallback(params: ClassificationParams): ClassificationResult {
  const from = (params.from || "").toLowerCase().trim();
  const subject = (params.subject || "").toLowerCase().trim();
  const body = (params.body || "").toLowerCase().trim();

  // 1. Detect explicit automated senders
  const isAutoSender =
    from.includes("no-reply") ||
    from.includes("noreply") ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster") ||
    from.includes("newsletter") ||
    from.includes("bounce") ||
    from.includes("alerts@") ||
    from.includes("notifications@") ||
    from.includes("support@github") ||
    from.includes("jira@") ||
    from.includes("system@") ||
    from.includes("bot@");

  if (isAutoSender) {
    return {
      qualifies: false,
      reason: "Sender address flagged as automated/system bot",
      isBotOrNewsletter: true,
    };
  }

  // 2. Detect typical bot/auto-reply subject lines
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
    subject.includes("automatic reply");

  if (isAutoSubject) {
    return {
      qualifies: false,
      reason: "Subject flagged as automated bounce, notification, or auto-reply",
      isBotOrNewsletter: true,
    };
  }

  // 3. Detect typical newsletter / mass marketing footers in body
  const isNewsletterBody =
    body.includes("click here to unsubscribe") ||
    body.includes("view in browser") ||
    body.includes("manage your preferences") ||
    body.includes("you are receiving this email because") ||
    body.includes("opt-out") ||
    body.includes("mailing list") ||
    body.includes("unsubscribe here");

  if (isNewsletterBody) {
    return {
      qualifies: false,
      reason: "Email body classified as mass newsletter/marketing",
      isBotOrNewsletter: true,
    };
  }

  // 4. Basic topic check (about company, product, booking, enquiry, interest, issue)
  const hasRelevanceKeywords =
    body.includes("b2b") ||
    body.includes("b2c") ||
    body.includes("portal") ||
    body.includes("cost") ||
    body.includes("pricing") ||
    body.includes("package") ||
    body.includes("software") ||
    body.includes("platform") ||
    body.includes("booking") ||
    body.includes("enquiry") ||
    body.includes("inquiry") ||
    body.includes("issue") ||
    body.includes("problem") ||
    body.includes("error") ||
    body.includes("demo") ||
    body.includes("interested") ||
    body.includes("help") ||
    body.includes("question") ||
    body.includes("contact") ||
    body.includes("support") ||
    body.includes("sales") ||
    body.includes("business") ||
    body.includes("client") ||
    body.includes("service") ||
    body.includes("product") ||
    body.includes("account") ||
    body.includes("integration") ||
    body.includes("partner");

  if (hasRelevanceKeywords) {
    return {
      qualifies: true,
      reason: "Message has relevant industry or enquiry keywords",
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
 * Classifies an inbound message using OpenAI API to strictly filter
 * out bots, newsletters, spam, and completely unrelated conversations.
 */
export async function classifyInboundMessage(params: ClassificationParams): Promise<ClassificationResult> {
  const openAiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const targetCompany = params.companyName || "Umrah360";

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

  if (openAiKey) {
    try {
      const openai = new OpenAI({ apiKey: openAiKey });
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
      console.warn("[OpenAI Classifier] Warning during classification, falling back to Rule-based:", err?.message || err);
    }
  }

  // Fallback to Regex and static keyword detection
  const fallbackResult = classifyInboundMessageFallback(params);
  console.log(`[Fallback Classifier] Inbound classified: qualifies=${fallbackResult.qualifies}, reason="${fallbackResult.reason}"`);
  return fallbackResult;
}
