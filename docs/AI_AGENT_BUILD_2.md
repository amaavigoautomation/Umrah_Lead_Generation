# AI Agent workspace — Build 2

## Workspace experience

- Dedicated AI Agent workspace and a draggable floating companion.
- The full workspace and companion share conversation history and task context.
- Campaign email artifacts are stored on assistant messages and render as sandboxed HTML previews inside the chat.
- The preview provides an action to open the matching draft in Template Studio → Campaign Emails → My Designs.

## Models

- Agent reasoning and tool orchestration use OpenAI Responses API with `gpt-6.1-sol` by default. Override with `AGENT_MODEL_ID`.
- The reasoning effort defaults to `medium`; override with `AGENT_REASONING_EFFORT`.
- Campaign artwork uses `gpt-image-2.5-flare` by default. Override with `AGENT_IMAGE_MODEL_ID`.
- The OpenAI API key remains server-side.

## Registered capabilities

The Agent can inspect company profile details, search published Knowledge Base articles, research the official company website, list company assets and email designs, and inspect lead database summaries.

It can also create and revise AI-managed campaign email drafts:
1. Read Company Profile and search the Knowledge Base for facts, plans, pricing, eligibility and offer details.
2. Research the official website for brand identity and color cues when a website is configured.
3. Use the company logo from Company Profile or the existing LOGO asset; never redraw the company logo.
4. Generate an artwork-only campaign hero with GPT Image 2.5 Flare (no baked-in logo or copy).
5. Save the generated image to the tenant's Company Assets.
6. Build email-client-friendly, table-based HTML with inline styles, accessible image text, subject and preheader.
7. Save to the existing tenant campaign template store, which appears under Template Studio → Campaign Emails → My Designs.
8. Return the rendered HTML and metadata as a conversation artifact so the preview is visible in the Agent chat.

Only AI-managed drafts created by the current user in the same conversation can be revised through the revision tool. Copy/layout revisions can preserve the existing hero image; a requested image change generates a replacement. Recent versions are retained in the template snapshot.

## Security and execution boundaries

- Every request derives tenant identity and actor identity from the verified Firebase session. The model cannot choose a tenant.
- Agent access, Email Design Studio permission, Knowledge Base permission, campaign entitlement and AI usage quota are checked server-side.
- Tenant campaign templates and Company Assets are written using existing service methods, not raw model-authored Firestore writes.
- Template creation/revision never sends email, launches campaigns, dispatches WhatsApp, invokes Meta operations or deletes unrelated records.
- Other existing saved templates cannot be modified by the revision tool.
- Generated HTML is sanitized before persistence and rendering. It must contain a safe table layout, generated hero image and one company logo slot.
- Generated images are bounded to fit the Company Assets storage limits. If template persistence fails, a newly generated image is cleaned up.
- Each chat turn has an atomic execution ID. A saved artifact is attached to the chat as soon as the template is verified, so a timeout during final wording does not lose the preview.
- The client can query the same execution ID after a connection interruption and recover the saved assistant artifact without submitting a duplicate task.
- Audit events include the actor, tool, action, outcome and resulting template/image IDs.

## Memory

- Conversation/task memory is private to the initiating user and stored in tenant-scoped conversation messages.
- Company preferences are tenant-wide and shared with Agent users; only workspace admins can edit them.
- No individual-user long-term memory is stored.
- The Agent asks before turning inferred recurring preferences into permanent company guidance.

## API surface

- GET /api/agent/bootstrap
- POST /api/agent/conversations
- GET /api/agent/conversations/:id
- POST /api/agent/chat
- GET /api/agent/executions/:id
- PATCH /api/agent/config

All routes are authenticated and pass through the common AI Agent entitlement gate. Campaign email draft creation separately checks the campaign entitlement.
