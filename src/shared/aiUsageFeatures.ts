export const AI_USAGE_FEATURES = [
  { key: 'ai_agent', label: 'AI Agent' },
  { key: 'playground', label: 'AI Testing Playground' },
  { key: 'unified_inbox', label: 'Unified Inbox replies' },
  { key: 'inbound_email', label: 'Inbound email automation' },
  { key: 'inbound_whatsapp', label: 'WhatsApp automation' },
  { key: 'website_chatbot', label: 'Website chatbot' },
  { key: 'instagram', label: 'Instagram automation' },
  { key: 'meta_channels', label: 'Other Meta channels' },
  { key: 'human_handoff', label: 'Human handoff classification' },
  { key: 'demo_scheduling', label: 'Demo scheduling' },
  { key: 'auto_follow_up', label: 'Auto follow-up' },
  { key: 'campaign_personalization', label: 'Campaign personalization' },
  { key: 'campaign_preview', label: 'Campaign previews' },
  { key: 'campaign_reports', label: 'Campaign reports' },
  { key: 'email_design', label: 'Email Design Studio' },
  { key: 'knowledge_base_scan', label: 'Website knowledge scan' },
  { key: 'campaign_image_generation', label: 'AI image generation' },
  { key: 'message_classification', label: 'Inbound message classification' },
  { key: 'unclassified', label: 'Other AI requests' },
] as const;

export type AiUsageFeatureId = (typeof AI_USAGE_FEATURES)[number]['key'];

export interface AiFeatureUsageTotals {
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequestCount: number;
  aiCostUsd: number;
  aiUnpricedRequestCount: number;
}

export const AI_USAGE_FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  AI_USAGE_FEATURES.map((feature) => [feature.key, feature.label]),
);
