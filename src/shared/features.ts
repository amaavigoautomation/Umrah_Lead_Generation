/**
 * Feature registry: everything that CAN be gated by a plan.
 * Which plan includes what is DATA (Firestore `plans/{id}`), edited in the Platform Console.
 * Code only ever asks "does this workspace have feature X?" and never checks a plan name.
 *
 * Add a line here only when you build something new that could be sold.
 */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  /** Tab id in the UI that this feature unlocks (if any). */
  tab?: string;
  /** When a plan does not mention this feature: on (true) or off (false). New features default to on. */
  defaultEnabled: boolean;
}

export const FEATURES: FeatureDef[] = [
  { key: 'campaigns', label: 'Outbound campaigns', description: 'Cold outreach campaigns and batch sending', tab: 'campaigns', defaultEnabled: true },
  { key: 'scheduling', label: 'Demo scheduling', description: 'Calendar availability and demo booking', tab: 'scheduling', defaultEnabled: true },
  { key: 'knowledge_base', label: 'Knowledge base', description: 'Documents the AI answers from', tab: 'knowledge', defaultEnabled: true },
  { key: 'auto_followup', label: 'AI Auto Follow-Up', description: 'Automatic follow-ups for leads that go quiet', tab: 'auto-followup', defaultEnabled: true },
  { key: 'custom_domain', label: 'Custom sending domain', description: 'Send email from your own domain', defaultEnabled: true },
];

export interface LimitDef {
  key: string;
  label: string;
  unit: string;
  /** Used when neither the plan, an override nor the workspace itself defines this limit. */
  fallback: number;
}

export const LIMITS: LimitDef[] = [
  { key: 'seats', label: 'Team seats', unit: 'users', fallback: 10 },
  { key: 'dailyOutboundSends', label: 'Emails per day', unit: 'emails', fallback: 3_000 },
  { key: 'hourlyOutboundSends', label: 'Emails per hour', unit: 'emails', fallback: 500 },
  { key: 'monthlyAiTokens', label: 'AI tokens per month', unit: 'tokens', fallback: 2_000_000 },
];

export type FeatureKey = (typeof FEATURES)[number]['key'];

export const FEATURE_BY_TAB: Record<string, string> = Object.fromEntries(
  FEATURES.filter((f) => f.tab).map((f) => [f.tab as string, f.key])
);
