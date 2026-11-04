# AI Agent workspace — proactive operations and execution

## Models
- Agent reasoning and tool orchestration: OpenAI Responses API using `gpt-6.1-sol` by default. Override through `AGENT_MODEL_ID`.
- Campaign artwork: OpenAI image generation using `gpt-image-2.5-flare` by default. Override through `AGENT_IMAGE_MODEL_ID`.
- Reasoning effort defaults to `medium`. OpenAI credentials remain on the server.

## Template type discovery
When the user asks to create an ambiguous template, the Agent first asks which platform destination they mean:
- Conversation / AI Email Design for Unified Inbox replies and follow-ups.
- Campaign Email Template for outbound campaigns.
- WhatsApp Template for WhatsApp marketing or utility.

## Preview-first design workflow
1. Read Company Profile and the uploaded company logo.
2. Check the tenant's LOGO asset before using a website logo. Verify the tenant asset document and its public asset route.
3. Research the official website when configured to gather public brand colors and visual cues.
4. Search the published Knowledge Base for products, pricing, eligibility and claims. Check both module access and the tenant's `knowledge_base` entitlement.
5. Generate relevant artwork with GPT Image Flare. Keep the company's existing logo and all copy as separate editable elements.
6. Save generated artwork as a tenant Company Asset and verify that the asset can be served before returning a preview.
7. Render the design in the Agent conversation. No email or WhatsApp template collection is modified at this stage.
8. Ask where the user wants the design saved. Save only after the user confirms the destination.

### Destinations
- Campaign email → existing tenant campaign template service, shown in Template Studio → Campaign Emails → My Designs.
- Conversation email → existing Email Design Studio service, shown in Email Design Studio → My Designs. It must have exactly one `{{content}}` placeholder.
- WhatsApp → Agent draft collection, or a separate explicit submission to Meta for review.
- The conversation card provides a rendered preview and an action to open the saved email design in the correct Template Studio tab.

## Campaign preparation and sending
- The Agent can inspect saved campaign templates and lead databases.
- Preparing an outbound campaign requires Campaigns and Database module permissions and the campaign entitlement.
- The Agent uses the existing server-side database snapshot function. The model does not receive individual recipient addresses.
- It creates a campaign in DRAFT status and a separate tenant-scoped approval record. The chat card shows the chosen template, selected database, eligible recipients, excluded records without a valid email, and sender readiness.
- Preparation never sends email.
- A separate explicit confirmation is required to dispatch. The server verifies the approval record owner and conversation, checks permissions and campaign entitlement, rechecks sender readiness, and atomically claims the dispatch.
- Dispatch uses the existing campaign engine, tracking and status counters. The Agent reports that dispatch started, not that every email was delivered.
- Campaign status can be inspected through the registered status tool.

## WhatsApp
- A WhatsApp preview is stored privately under the initiating user and conversation.
- A generated artwork asset can be uploaded to Meta through the existing resumable media upload service.
- Saving an Agent draft and submitting a template to Meta are distinct actions.
- Meta submission requires an authorized workspace role/module and explicit confirmation. The Agent reports Meta's returned status; submission is not described as approval.

## Execution, timeout recovery and audit
- Every Agent turn uses an atomic execution ID.
- Chat POST returns a processing acknowledgement. The task runs through Vercel `waitUntil`; progress is saved on the same execution document.
- The client polls the same execution ID and recovers the completed response without submitting a duplicate turn.
- This is bounded by the configured Vercel function runtime; it is not a separate durable job queue.
- Asset URLs use the active Vercel deployment URL when available, so preview links resolve against the deployment being tested.
- Asset IDs are parsed at their explicit double-underscore delimiter; tenant IDs containing underscores no longer fail the older first-underscore parser.
- Every write uses existing domain services. Audit events record tool execution, failures, template saves, Meta submission, campaign preparation and dispatch approval.

## Security boundaries
- Tenant and actor identity come only from the verified Firebase session. The model cannot choose a tenant.
- Module permissions, plan entitlements and AI usage quota are enforced server-side.
- Conversation/task memory is private to the initiating user. Company preferences are tenant-wide and admin-managed.
- Template saving, external Meta submission and email campaign dispatch are separate approval stages.
- The Agent never sends email merely because it prepared a template or campaign draft.
