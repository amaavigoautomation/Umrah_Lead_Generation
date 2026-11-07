# Umrah 360 — Full Product UI Redesign Blueprint

**Target branch:** `redesign/umrah360-experience`  
**Baseline:** `main` at `1aa4545f57c7e14c71b2d39b709e741f0470210f`  
**Audit date:** 7 November 2026

## 1. Product intent

This is a product-experience redesign, not a color refresh. The redesign must change the information architecture, page composition, navigation, interaction patterns, hierarchy, density, responsive behavior, and component system while preserving the existing product's workflows and business rules.

The intended result is a cohesive enterprise operations platform for lead acquisition, customer conversations, sales execution, campaigns, scheduling, AI assistance, and workspace administration.

## 2. Current application architecture — audited

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4, Lucide icons, Motion.
- Backend: Express API and server-side services.
- Data/auth: Firebase Authentication and Firestore, with tenant-scoped data and multi-workspace support.
- Hosting/build: Vercel configuration with Vite build output and API function rewrites.
- App entry: `src/main.tsx` → `src/App.tsx`.
- `App.tsx` is the central application coordinator. It owns authentication, tenant/workspace state, shared data, permissions, plan entitlements, tab selection, and the handlers passed into feature screens.
- Module screens are selected through `activeTab`; the tab is persisted to the URL query string and session storage. This behavior must remain intact.
- Several screens are lazy-loaded. Keep code splitting and the existing lazy-load recovery behavior.
- Workspace branding is supplied through `BrandProvider`; the AI agent uses `AgentProvider`. Preserve both contexts.
- The existing frontend uses Tailwind utility classes heavily. `src/index.css` is only a small global stylesheet and there is no comprehensive shared component/design-system layer yet.

### Current navigation destinations

| Tab id | Current screen | Component |
|---|---|---|
| `inbox` | Unified Inbox | `UnifiedInbox` |
| `agent` | AI Agent Workspace | `AgentWorkspace` |
| `auto-followup` | Auto Follow-Up | `AutoFollowUpDashboard` |
| `database` | Lead Database | `LeadDatabase` |
| `campaigns` | Outbound Campaigns | `CampaignManagement` |
| `campaign-reports` | AI Campaign Reporting | `CampaignReports` |
| `email-design-studio` | Email Design Studio / Template Studio | `TemplateStudio` |
| `crm` | CRM & Lead Pipeline | `CrmPipeline` |
| `scheduling` | Demo Scheduling | `DemoSchedulingView` |
| `knowledge` | Knowledge Base | `KnowledgeBaseView` |
| `playground` | AI Testing | `AiTestingPlayground` |
| `audit-logs` | Audit Logs | `AuditLogsView` |
| `company-profile` | Company Profile | `BrandSettingsPanel` |
| `settings` | Settings | `SettingsView` |

Additional authenticated experiences include Platform Console for platform administrators and a full-screen Billing view for locked workspaces. Public routes include the landing page, login, and legal pages.

**Important scope findings:**
- There is no first-class Dashboard tab/screen in the current main-branch navigation.
- There is no dedicated Lead Scraping tab/component in the current main-branch screen inventory. Treat this as a separate product-scope decision/feature build, not as an existing screen to restyle.
- Keep the existing access checks, plan locks, workspace-level permissions, tenant switcher, and billing states.

## 3. Problems in the current shell to address

1. Navigation is a flat list of destinations rather than a hierarchy organized around user jobs.
2. The same sidebar-collapse action appears in multiple places, creating redundant controls.
3. The top bar primarily repeats the current page icon and channel/account actions; it does not establish a strong page-level action hierarchy.
4. The application shell and each module use their own layout conventions; the visual and interaction language is inconsistent.
5. Shared patterns for page headers, filters, tables, drawers, empty states, loading states, and feedback are not centralized.
6. The main area uses generic padding/overflow rules at the shell level; modules need page-specific layout ownership while remaining responsive to the shell.
7. The current brand styling is not the issue to solve by itself. The redesign needs more deliberate composition, whitespace, typography, data density, and navigation structure.

## 4. Proposed information architecture

The navigation should be grouped by the work users perform. Existing tab IDs remain unchanged so saved links, permissions, and current callbacks continue working.

- **Engage:** Unified Inbox
- **Sales:** CRM & Leads, Auto Follow-Up, Demo Scheduling
- **Growth:** Lead Database, Campaigns, Email Design Studio, Campaign Reports
- **AI Workspace:** AI Agent, Knowledge Base, AI Testing
- **Administration:** Audit Logs, Company Profile, Settings

A Dashboard / Command Center is a proposed new first-class destination because the current app has no such screen. It should only be added once it can use real workspace data and meaningful navigation actions; it must not be populated with invented metrics. Platform Console and Billing remain dedicated access-controlled experiences.

## 5. Product-wide design system

Build a shared system before converting every screen. The system should define:

- App shell: desktop sidebar, collapsed rail, mobile drawer, top bar, content frame.
- Navigation: grouped labels, active state, badges, tooltips, plan/permission states.
- Page header: eyebrow/breadcrumb, title, contextual description, primary and secondary actions.
- Controls: buttons, icon buttons, inputs, search, selects, segmented controls, date controls.
- Data: tables, row selection, column density, sorting, filtering, pagination, bulk-action bars.
- Surfaces: cards/panels, drawers, dialogs, popovers, tabs, split panes.
- Feedback: empty, loading, skeleton, success, warning, error, and destructive confirmation states.
- Responsive rules: content must reflow when the sidebar collapses, the viewport narrows, or a drawer opens.
- Accessibility: keyboard focus, readable contrast, semantic controls, labels, reduced motion.

Colors and brand assets should be tokens in the system, not the entire design strategy. Preserve workspace branding support.

## 6. Module redesign briefs

### Unified Inbox
A dedicated conversation workspace. Recompose it around a navigable inbox/folder rail, searchable conversation list, focused message thread, and contextual customer/lead panel. Make channel, unread, assignment, AI mode, human handoff, and message state visible without overwhelming the message area. Preserve send/reply/template, draft approval/editing, AI toggle, CRM navigation, sync, and handoff behavior.

### CRM & Leads
A sales workspace with clear pipeline/status navigation, useful table or board views, fast filters, search, assignment, bulk actions, and a detailed lead profile/activity drawer. Preserve lead status updates, lead creation/editing, call logs, callbacks, AI follow-up scheduling, and conversation handoff.

### Auto Follow-Up
An operations console focused on execution health: enabled/paused state, due/queued/sent/failed work, next scheduled action, failure reason, filters, and drill-down into a lead or conversation. Preserve existing schedule and refresh behavior.

### Lead Database
A database workspace that distinguishes database inventory from lead records. Make row counts, source, ownership/availability, import status, duplicate outcomes, and campaign usage clear. Preserve the existing backend rules around shared workspace access and admin-only destructive actions.

### Campaigns
A campaign workspace with clear lifecycle states, audience/database selection, design selection, readiness checks, scheduling, sending, and results. Campaign audience selection must continue to use the existing snapshot semantics and backend campaign APIs.

### Email Design Studio / Template Studio
A full-width creation workspace with template/library navigation, visual editing, HTML editing where supported, responsive previews, brand assets, validation, and save/send actions. Preserve the existing editor and email sending integrations.

### AI Campaign Reporting
A reporting workspace with selectable reporting periods/campaigns, explainable metrics, report synthesis, and export actions. Use actual report data and preserve PDF/report generation.

### Demo Scheduling
A calendar-first operations workspace with day/week/list views, slot availability, booking details, lead context, and rescheduling/cancellation workflows. Preserve Google Calendar/Meet integration and booking constraints.

### AI Agent
A dedicated AI work area with conversation/history, prompt composer, attachments/artifacts, autonomy/approval state, and task context. Keep agent state and existing tool execution behavior intact.

### Knowledge Base
A knowledge operations workspace with document inventory, source/website sync state, ingestion progress, coverage, and document actions. Preserve current RAG and website knowledge behavior.

### AI Testing
A focused test bench for prompt/channel simulation, knowledge validation, and response inspection. Keep actual API-backed test behavior.

### Audit Logs
A searchable, filterable activity ledger with clear actor, action, module, target, timestamp, and detail views. Preserve tenant scoping.

### Company Profile
A structured workspace identity/settings experience for branding and company information. Preserve `BrandProvider` and workspace-specific brand persistence.

### Settings
A settings center organized by task area (workspace, team/access, channels, email, WhatsApp/Instagram, calendar, AI, security/billing as applicable). Preserve existing subpanels, permissions, OAuth flows, and server-backed settings.

### Platform Console / Billing / Public pages
Keep these access-controlled or public experiences separate from the normal workspace navigation, but bring their layout and shared components into the same design system.

## 7. Implementation sequence

1. **Foundation:** Build and validate the new application shell, navigation hierarchy, page-header patterns, design tokens, and responsive behavior. Keep current tab IDs and existing feature wiring.
2. **Core workspaces:** Redesign Unified Inbox and CRM first because they are the primary conversation-to-conversion workflows.
3. **Growth workspaces:** Redesign Database, Campaigns, Email Design Studio, and Campaign Reports.
4. **Operations and intelligence:** Redesign Auto Follow-Up, Demo Scheduling, AI Agent, Knowledge Base, and AI Testing.
5. **Administration:** Redesign Audit Logs, Company Profile, Settings, Platform Console, Billing, Login, Landing, and legal pages.
6. **QA:** Run TypeScript/build checks; verify desktop, collapsed sidebar, mobile navigation, permissions, plan locks, tab URL persistence, Firestore/API data flow, and key workflows.

## 8. Non-regression requirements

- Do not change API contracts, Firestore schemas, tenant isolation, auth, entitlements, or server-side business logic as part of a visual-only task.
- Do not remove existing controls, features, filters, or actions without an explicit product decision.
- Do not replace backend values with mock/dummy data.
- Keep existing active-tab identifiers, deep links, permissions, billing locks, and workspace branding.
- Keep lazy loading where it benefits initial load.
- Build on a dedicated redesign branch; do not push unfinished work directly to `main`.
- Do not deploy until the redesigned screens pass build and functional checks.

## 9. Initial files to evolve

- `src/App.tsx`: shell composition and tab rendering only where necessary; keep data orchestration and handlers stable.
- `src/components/Navbar.tsx`: grouped navigation and responsive sidebar.
- `src/components/HeaderBar.tsx`: purposeful page-level top bar.
- `src/index.css`: design tokens, typography, global primitives, focus/scroll behavior.
- Add a shared `src/components/ui/` or similarly scoped system for reusable visual primitives.
- Then redesign each existing screen in place, preserving its public props and business workflows.
