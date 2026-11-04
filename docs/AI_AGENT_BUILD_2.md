# AI Agent workspace — Build 2 foundation

## Delivered in this slice

- Dedicated AI Agent workspace and a floating companion available across workspace modules.
- Shared client provider so the page and companion use the same active conversation state.
- Tenant-scoped conversation records and messages. Each conversation is readable only by its initiating Firebase user.
- Tenant-wide company preferences, visible to Agent users and editable by workspace admins.
- Workspace autonomy preference: Ask before everything, Balanced (default), or Full autonomy.
- A server-side registered tool catalogue for company profile, published Knowledge Base search, lead database summaries, company asset metadata, and email design metadata.
- Tool calls execute backend service methods with the authenticated tenant context. The model cannot supply or override tenant identity.
- AI usage is checked against the workspace monthly token quota and recorded from provider-reported usage.
- Tool execution and policy changes are written to the tenant audit trail.
- Each chat turn reserves a unique execution ID with an atomic Firestore create. Duplicate submissions return the completed response or a conflict instead of repeating work.

## Execution boundary in this release

The registered catalogue is deliberately read-only. The Agent can inspect and explain workspace data, and can prepare plans in conversation, but it cannot create, edit, delete, schedule, send messages, dispatch campaigns, or invoke Meta operations. The autonomy preference is persisted for the future action registry; it does not grant permissions or activate unavailable tools.

Before any write tool is introduced, it must:
1. Be registered with a strict input schema and an explicit required module permission.
2. Derive tenant and actor context from the verified request session.
3. Invoke existing domain service methods rather than writing raw Firestore documents.
4. Declare risk and approval requirements. External sends, campaign dispatch, Meta operations, and destructive actions require explicit approval/safety gates even under Full autonomy.
5. Use a server-generated or validated idempotency key for each mutation.
6. Return structured success, failure, or pending status; the Agent must verify outcomes before reporting success.
7. Emit tenant-scoped audit events.

## Memory boundaries

- Conversation/task memory is private to the initiating user and is persisted as messages under the tenant's conversation record.
- Company preferences are tenant-wide and shared with Agent users. Only workspace admins can change them.
- No individual-user long-term memory is stored.
- The Agent should ask before turning an inferred recurring preference into permanent company guidance.

## API surface

- GET /api/agent/bootstrap
- POST /api/agent/conversations
- GET /api/agent/conversations/:id
- POST /api/agent/chat
- PATCH /api/agent/config

All routes are authenticated and pass through the common entitlement/payment gates. Unsupported routes return 404.
