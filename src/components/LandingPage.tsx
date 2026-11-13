import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  CalendarCheck,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  Filter,
  Globe,
  Headphones,
  Inbox,
  Layers,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import './LandingPage.css';

const DEMO_URL = 'https://www.amaavigo.com/consult-now';
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type LinkItem = { label: string; href: string; description: string };
type NavGroup = { label: string; href: string; links: LinkItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Platform', href: '/platform', links: [
      { label: 'Platform overview', href: '/platform', description: 'The connected lead-to-revenue workspace' },
      { label: 'Lead capture', href: '/lead-capture', description: 'Bring enquiries into one place' },
      { label: 'Unified Inbox', href: '/unified-inbox', description: 'Every customer conversation together' },
      { label: 'AI Agent', href: '/ai-agents', description: 'Move work forward with one prompt' },
      { label: 'CRM & lead databases', href: '/crm', description: 'Keep every opportunity organised' },
      { label: 'Demo scheduling', href: '/demo-scheduling', description: 'Turn interest into a booked meeting' },
      { label: 'Campaigns & WhatsApp', href: '/campaigns', description: 'Create, send and measure engagement' },
      { label: 'Analytics', href: '/analytics', description: 'See what happened after every touch' },
    ],
  },
  {
    label: 'Solutions', href: '/solutions', links: [
      { label: 'Travel & Umrah operators', href: '/solutions#travel', description: 'Coordinate enquiries through booking' },
      { label: 'Sales teams', href: '/solutions#sales', description: 'Keep pipeline and conversations aligned' },
      { label: 'Service businesses', href: '/solutions#service', description: 'Give every customer request a next step' },
    ],
  },
  {
    label: 'Resources', href: '/resources', links: [
      { label: 'How it works', href: '/resources#how-it-works', description: 'Follow the lead journey' },
      { label: 'Integrations', href: '/integrations', description: 'Connect your existing channels' },
      { label: 'FAQs', href: '/resources#faqs', description: 'Answers about the platform' },
    ],
  },
];

const CAPABILITIES: Array<{ icon: LucideIcon; title: string; copy: string; href: string; tag: string }> = [
  { icon: Globe, title: 'Lead capture', copy: 'Bring website enquiries, connected channels and imported prospects into one organised workspace.', href: '/lead-capture', tag: 'ATTRACT' },
  { icon: Inbox, title: 'Unified Inbox', copy: 'Give your team one place to read, reply, review AI drafts and take over conversations.', href: '/unified-inbox', tag: 'RESPOND' },
  { icon: Bot, title: 'AI Agent', copy: 'Ask for a workflow in plain language. Let the agent prepare work across connected modules.', href: '/ai-agents', tag: 'EXECUTE' },
  { icon: Users, title: 'CRM & databases', copy: 'Keep lead records, ownership, stages and campaign audiences connected to the conversation.', href: '/crm', tag: 'ORGANISE' },
  { icon: CalendarCheck, title: 'Demo scheduling', copy: 'Coordinate calendar availability and move a qualified conversation to a confirmed meeting.', href: '/demo-scheduling', tag: 'CONVERT' },
  { icon: Send, title: 'Campaigns & WhatsApp', copy: 'Create branded communication, build custom templates and follow campaign performance.', href: '/campaigns', tag: 'GROW' },
];

const THREADS = [
  {
    name: 'Ayesha Khan', initials: 'AK', color: 'mint', channel: 'WhatsApp', time: 'Now',
    preview: 'I would like to know more about your services.',
    incoming: 'Hi, I found your website and would like to understand how your service works.',
    reply: 'Welcome, Ayesha. I can help with that. May I ask what your team is currently using to manage new enquiries?',
    status: 'AI reply drafted', label: 'New enquiry',
  },
  {
    name: 'Imran Patel', initials: 'IP', color: 'blue', channel: 'Email', time: '4m',
    preview: 'Could we arrange a product walkthrough?',
    incoming: 'Our team is exploring a better way to handle inbound leads. Can we schedule a walkthrough?',
    reply: 'Absolutely. I can help arrange a walkthrough. Which day is generally most convenient for your team?',
    status: 'Demo intent detected', label: 'High intent',
  },
  {
    name: 'Sara Merchant', initials: 'SM', color: 'peach', channel: 'Website', time: '12m',
    preview: 'Please share the available options.',
    incoming: 'I submitted the form a little earlier. Could someone share the available options?',
    reply: 'Thanks for reaching out, Sara. I have your enquiry. I can share the relevant information or connect you with a specialist.',
    status: 'Human handoff available', label: 'Needs attention',
  },
];

const JOURNEY_STEPS: Array<{ number: string; title: string; short: string; body: string; icon: LucideIcon; signal: string }> = [
  { number: '01', title: 'A lead arrives', short: 'Capture', body: 'An enquiry comes in through a website form, WhatsApp, a connected channel or an imported lead list. Amaavigo brings it into the same workspace.', icon: Globe, signal: 'New enquiry received' },
  { number: '02', title: 'The conversation starts', short: 'Engage', body: 'The conversation becomes visible in Unified Inbox. AI can respond using your configured business knowledge and the conversation context.', icon: MessageCircle, signal: 'AI response prepared' },
  { number: '03', title: 'Intent becomes clear', short: 'Qualify', body: 'Lead details, questions and conversation history stay together. Your team can review the context or step in when human attention is needed.', icon: Sparkles, signal: 'Lead context updated' },
  { number: '04', title: 'A meeting gets booked', short: 'Schedule', body: 'When the customer is ready, the scheduling workflow can check configured availability and coordinate a demo or consultation.', icon: CalendarCheck, signal: 'Meeting confirmation' },
  { number: '05', title: 'The relationship continues', short: 'Grow', body: 'The lead stays in CRM. Campaigns, follow-ups and reporting help your team continue the relationship and understand what happened next.', icon: BarChart3, signal: 'Next action connected' },
];

const PROMPT_PRESETS = [
  {
    label: 'Prepare a follow-up campaign',
    prompt: 'Find leads who enquired but have not booked. Review the relevant conversations, prepare a follow-up campaign in our brand voice, and show me the draft before anything is sent.',
    actions: ['Review lead databases and recent conversations', 'Check approved company knowledge and brand context', 'Prepare campaign content and creative preview', 'Create a draft for your review', 'Wait for explicit approval before dispatch'],
  },
  {
    label: 'Create a WhatsApp template',
    prompt: 'Create a WhatsApp template for a new customer enquiry. Use our brand voice, include the right personalisation fields, and prepare it for review.',
    actions: ['Check the company tone and intended use', 'Draft the template structure and variables', 'Prepare a preview with example values', 'Save the draft to Template Studio', 'Submit to Meta for approval when authorised'],
  },
  {
    label: 'Understand campaign performance',
    prompt: 'Compare our recent campaigns. Show me what drove replies and booked demos, highlight gaps, and recommend the next action.',
    actions: ['Retrieve the selected campaign records', 'Compare engagement and delivery outcomes', 'Review replies and tracked demo outcomes', 'Prepare an insight-led report', 'Recommend practical next steps'],
  },
];

const PAGE_META: Record<string, { eyebrow: string; title: string; accent: string; description: string; icon: LucideIcon; points: string[]; next: Array<{ title: string; copy: string; href: string }> }> = {
  '/platform': {
    eyebrow: 'THE AMAAVIGO PLATFORM', title: 'The work between a new lead and a customer.', accent: 'Connected.', description: 'Bring lead capture, customer conversations, AI assistance, scheduling, campaigns and reporting into one connected sales operation.',
    icon: Layers,
    points: ['Capture enquiries from supported channels and forms', 'Manage every conversation and handoff in one place', 'Use AI to prepare work across connected modules', 'Coordinate follow-up, meetings and campaigns', 'Understand activity across the customer journey'],
    next: [{ title: 'Capture demand', copy: 'Bring new enquiries into one workspace.', href: '/lead-capture' }, { title: 'Work every conversation', copy: 'Keep AI and human responses together.', href: '/unified-inbox' }, { title: 'Move the work forward', copy: 'Ask the AI Agent to prepare next steps.', href: '/ai-agents' }],
  },
  '/lead-capture': {
    eyebrow: 'LEAD CAPTURE', title: 'Every new enquiry starts in the right place.', accent: 'One workspace.', description: 'Bring enquiries from your website, connected messaging channels and imported lead lists into an organised operating flow.',
    icon: Globe, points: ['Website forms and inbound lead endpoints', 'WhatsApp and supported connected channels', 'CSV and Excel lead imports', 'Duplicate checks and import review', 'Separate lead databases for campaign audiences'],
    next: [{ title: 'Database organisation', copy: 'Keep reusable lead audiences organised.', href: '/crm' }, { title: 'Start the conversation', copy: 'Respond from one shared Inbox.', href: '/unified-inbox' }, { title: 'Run the next action', copy: 'Use AI to prepare follow-up work.', href: '/ai-agents' }],
  },
  '/unified-inbox': {
    eyebrow: 'UNIFIED INBOX', title: 'One conversation view for every channel you connect.', accent: 'One context.', description: 'Give your team a shared place to manage supported customer conversations, review AI drafts, take over when needed and see lead context alongside the thread.',
    icon: Inbox, points: ['WhatsApp, email, website and supported social conversations', 'Conversation views, search and status filters', 'AI, review and off operating modes', 'Human handoff, ownership and conversation controls', 'Lead profile and activity alongside messages'],
    next: [{ title: 'AI-assisted replies', copy: 'Let the agent prepare the next response.', href: '/ai-agents' }, { title: 'Lead context', copy: 'Keep records and conversations together.', href: '/crm' }, { title: 'Schedule the next step', copy: 'Turn interest into a meeting.', href: '/demo-scheduling' }],
  },
  '/ai-agents': {
    eyebrow: 'AMAAVIGO AI AGENT', title: 'Describe the outcome. Let the agent prepare the work.', accent: 'You stay in control.', description: 'Use one conversational workspace to research, organise, draft and prepare actions across connected Amaavigo modules—with permissions and approval boundaries intact.',
    icon: Bot, points: ['Research public company branding and configured knowledge', 'Review available lead databases and campaign templates', 'Prepare email and WhatsApp template previews', 'Prepare campaign drafts and campaign reports', 'Respect workspace permissions and explicit approval for external actions'],
    next: [{ title: 'Create communication', copy: 'Build branded email and WhatsApp drafts.', href: '/campaigns' }, { title: 'Organise leads', copy: 'Use lead databases and CRM context.', href: '/crm' }, { title: 'Measure results', copy: 'Turn campaign data into an action plan.', href: '/analytics' }],
  },
  '/crm': {
    eyebrow: 'CRM & LEAD DATABASES', title: 'The lead record should never lose the conversation.', accent: 'Keep context connected.', description: 'Organise contacts, manage pipeline stages, assign ownership and maintain reusable campaign databases without losing the history that brought a lead to your team.',
    icon: Users, points: ['Lead and contact records in a shared workspace', 'Pipeline stages, status and ownership', 'Lead database collections and import history', 'Duplicate handling and audience organisation', 'Conversation and follow-up context close to the record'],
    next: [{ title: 'Bring leads in', copy: 'Capture and import new enquiries.', href: '/lead-capture' }, { title: 'Work the conversation', copy: 'Reply with the right context.', href: '/unified-inbox' }, { title: 'Reach the right audience', copy: 'Build a campaign from a saved database.', href: '/campaigns' }],
  },
  '/demo-scheduling': {
    eyebrow: 'DEMO SCHEDULING', title: 'Turn buying intent into a confirmed time.', accent: 'Without the back-and-forth.', description: 'Connect a calendar, configure working hours and session duration, and coordinate bookings from the customer conversation.',
    icon: CalendarCheck, points: ['Google Calendar and Microsoft 365 connections', 'Working days, hours, timezone and session duration', 'Calendar availability and booking management', 'Google Meet or Microsoft Teams meeting links', 'Scheduling agent simulation and conversation context'],
    next: [{ title: 'Qualify the enquiry', copy: 'Use AI and the conversation context.', href: '/ai-agents' }, { title: 'Keep the lead record', copy: 'Track progress inside CRM.', href: '/crm' }, { title: 'Measure the outcome', copy: 'Review campaign and booking activity.', href: '/analytics' }],
  },
  '/campaigns': {
    eyebrow: 'CAMPAIGNS & ENGAGEMENT', title: 'Create the message. Reach the right audience. Learn what worked.', accent: 'All connected.', description: 'Build email and WhatsApp communication, select your audience, coordinate delivery and understand engagement without losing the lead context.',
    icon: Send, points: ['Email campaigns and reusable branded designs', 'Custom WhatsApp template creation in Amaavigo', 'Lead database selection and recipient snapshots', 'Campaign scheduling and delivery tracking', 'Campaign reports, comparisons and AI recommendations'],
    next: [{ title: 'Design communication', copy: 'Create reusable email and WhatsApp drafts.', href: '/whatsapp' }, { title: 'Choose the audience', copy: 'Select a saved lead database.', href: '/crm' }, { title: 'Understand performance', copy: 'Generate campaign insights and reports.', href: '/analytics' }],
  },
  '/whatsapp': {
    eyebrow: 'WHATSAPP TEMPLATE STUDIO', title: 'Create WhatsApp communication in your own brand voice.', accent: 'Inside Amaavigo.', description: 'Build and preview custom WhatsApp templates in the workspace, add personalisation variables and manage the Meta review status from one place.',
    icon: MessageCircle, points: ['Create utility and marketing template drafts', 'Write your own message body and personalisation variables', 'Preview examples before submission', 'Track approval and rejection status', 'Use approved templates in eligible messaging workflows'],
    next: [{ title: 'Create a campaign', copy: 'Use your approved template with the right audience.', href: '/campaigns' }, { title: 'Keep context together', copy: 'Continue the customer conversation in Inbox.', href: '/unified-inbox' }, { title: 'Ask the AI Agent', copy: 'Prepare a template draft from one prompt.', href: '/ai-agents' }],
  },
  '/analytics': {
    eyebrow: 'ANALYTICS & REPORTING', title: 'See what happened after the message was sent.', accent: 'Measure the journey.', description: 'Connect delivery outcomes, engagement, replies, campaign comparisons and tracked demo activity to understand where your sales process is moving.',
    icon: BarChart3, points: ['Campaign engagement and delivery outcomes', 'Campaign comparisons and report history', 'AI-generated findings, risks and recommendations', 'Branded PDF report exports', 'Workspace-level AI usage and operational visibility'],
    next: [{ title: 'Launch a campaign', copy: 'Prepare the next audience and message.', href: '/campaigns' }, { title: 'Keep leads moving', copy: 'Coordinate follow-ups and demos.', href: '/demo-scheduling' }, { title: 'Use one prompt', copy: 'Ask the AI Agent to prepare a report.', href: '/ai-agents' }],
  },
  '/integrations': {
    eyebrow: 'INTEGRATIONS', title: 'Bring the channels your customers already use.', accent: 'Into one workspace.', description: 'Connect the messaging, email, calendar and website services your team relies on, subject to each provider’s access and eligibility requirements.',
    icon: Workflow, points: ['WhatsApp Business and supported Meta channels', 'Email inbox and sending connections', 'Google Calendar and Microsoft 365', 'Website forms and inbound lead workflows', 'Workspace APIs and supported webhooks'],
    next: [{ title: 'Manage conversations', copy: 'Work across connected channels.', href: '/unified-inbox' }, { title: 'Coordinate meetings', copy: 'Connect calendars and demo availability.', href: '/demo-scheduling' }, { title: 'Capture enquiries', copy: 'Bring forms and inbound leads together.', href: '/lead-capture' }],
  },
};

const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className, delay = 0 }) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 24, filter: 'blur(4px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: reduced ? 0 : 0.72, delay: reduced ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => (
  <span className={light ? 'av-eyebrow av-eyebrow-light' : 'av-eyebrow'}><i />{children}</span>
);

const ButtonLink: React.FC<{ href: string; children: React.ReactNode; secondary?: boolean; external?: boolean }> = ({ href, children, secondary = false, external = false }) => (
  <a className={secondary ? 'av-button av-button-quiet' : 'av-button av-button-primary'} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
    {children}<ArrowUpRight size={16} />
  </a>
);

const SiteHeader: React.FC<{ pathname: string }> = ({ pathname }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpenMenu(null); setMobileOpen(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  return (
    <header className="av-header">
      <div className="av-header-inner">
        <a href="/" className="av-brand" aria-label="Amaavigo home">
          <img src="/amaavigo-logo.png" alt="Amaavigo" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <span className="av-brand-fallback">amaavigo</span>
          <span className="av-brand-rule" />
          <span className="av-brand-caption">AI growth workspace</span>
        </a>
        <nav className="av-main-nav" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div className="av-nav-group" key={group.label} onMouseEnter={() => setOpenMenu(group.label)} onMouseLeave={() => setOpenMenu(null)}>
              <a href={group.href} className={pathname === group.href ? 'av-nav-trigger is-active' : 'av-nav-trigger'} aria-haspopup="true" aria-expanded={openMenu === group.label} onFocus={() => setOpenMenu(group.label)} onClick={(event) => { event.preventDefault(); setOpenMenu(openMenu === group.label ? null : group.label); }}>
                {group.label}<ChevronDown size={14} />
              </a>
              <AnimatePresence>
                {openMenu === group.label && (
                  <motion.div className="av-mega-menu" initial={{ opacity: 0, y: 9, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 7, scale: .99 }} transition={{ duration: .17, ease: EASE }}>
                    <div className="av-mega-top"><span>EXPLORE {group.label.toUpperCase()}</span><a href={group.href}>View overview <ArrowUpRight size={13} /></a></div>
                    <div className="av-mega-grid">
                      {group.links.map((link) => <a href={link.href} className="av-mega-link" key={link.href}><span className="av-mega-arrow"><ArrowUpRight size={14} /></span><span><strong>{link.label}</strong><small>{link.description}</small></span></a>)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
          <a href="/integrations" className={pathname === '/integrations' ? 'av-nav-simple is-active' : 'av-nav-simple'}>Integrations</a>
          <a href="/pricing" className={pathname === '/pricing' ? 'av-nav-simple is-active' : 'av-nav-simple'}>Pricing</a>
        </nav>
        <div className="av-header-actions"><a href="/login" className="av-login-link">Log in</a><ButtonLink href={DEMO_URL} external>Book a demo</ButtonLink></div>
        <button type="button" className="av-mobile-toggle" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)}>{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      <AnimatePresence>
        {mobileOpen && <motion.nav className="av-mobile-menu" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .22 }}>
          <a href="/platform" onClick={() => setMobileOpen(false)}>Platform</a><a href="/lead-capture" onClick={() => setMobileOpen(false)}>Lead capture</a><a href="/unified-inbox" onClick={() => setMobileOpen(false)}>Unified Inbox</a><a href="/ai-agents" onClick={() => setMobileOpen(false)}>AI Agent</a><a href="/crm" onClick={() => setMobileOpen(false)}>CRM & databases</a><a href="/demo-scheduling" onClick={() => setMobileOpen(false)}>Demo scheduling</a><a href="/campaigns" onClick={() => setMobileOpen(false)}>Campaigns & WhatsApp</a><a href="/solutions" onClick={() => setMobileOpen(false)}>Solutions</a><a href="/integrations" onClick={() => setMobileOpen(false)}>Integrations</a><a href="/pricing" onClick={() => setMobileOpen(false)}>Pricing</a><a href="/resources" onClick={() => setMobileOpen(false)}>Resources</a><a href="/about" onClick={() => setMobileOpen(false)}>About</a><a href="/login" onClick={() => setMobileOpen(false)}>Log in</a>
          <a href={DEMO_URL} target="_blank" rel="noreferrer" className="av-mobile-demo" onClick={() => setMobileOpen(false)}>Book a demo <ArrowUpRight size={15} /></a>
        </motion.nav>}
      </AnimatePresence>
    </header>
  );
};

const SiteFooter: React.FC = () => (
  <footer className="av-footer">
    <div className="av-footer-main">
      <div className="av-footer-brand">
        <a href="/" className="av-brand av-footer-logo"><img src="/amaavigo-logo.png" alt="Amaavigo" onError={(event) => { event.currentTarget.style.display = 'none'; }} /><span className="av-brand-fallback">amaavigo</span></a>
        <p>From the first enquiry to the next sales conversation. One connected workspace to keep the work moving.</p>
        <span className="av-footer-note"><span /> Built around the customer journey</span>
      </div>
      <div className="av-footer-col"><strong>Platform</strong><a href="/platform">Overview</a><a href="/lead-capture">Lead capture</a><a href="/unified-inbox">Unified Inbox</a><a href="/ai-agents">AI Agent</a><a href="/crm">CRM & databases</a><a href="/demo-scheduling">Demo scheduling</a></div>
      <div className="av-footer-col"><strong>Engagement</strong><a href="/campaigns">Campaigns</a><a href="/whatsapp">WhatsApp templates</a><a href="/analytics">Analytics & reporting</a><a href="/integrations">Integrations</a><a href="/solutions">Solutions</a></div>
      <div className="av-footer-col"><strong>Company</strong><a href="/pricing">Pricing</a><a href="/resources">Resources & FAQs</a><a href="/about">About Amaavigo</a><a href="/contact">Contact</a><a href="/login">Log in</a></div>
      <div className="av-footer-col"><strong>Legal</strong><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/dpa">Data Processing Agreement</a><a href="/aup">Acceptable Use & AI Policy</a></div>
    </div>
    <div className="av-footer-bottom"><span>© {new Date().getFullYear()} Amaavigo Digital Solutions LLP. All rights reserved.</span><span>Lead capture → conversation → conversion.</span></div>
  </footer>
);

const HeroWorkspace: React.FC = () => {
  const [selected, setSelected] = useState(0);
  const thread = THREADS[selected];
  return (
    <div className="av-hero-product">
      <div className="av-product-aura" />
      <div className="av-product-grid" />
      <motion.div className="av-product-shell" initial={{ opacity: 0, y: 35, rotateX: 3, rotateY: -4 }} animate={{ opacity: 1, y: 0, rotateX: 0, rotateY: 0 }} transition={{ duration: 1.05, delay: .14, ease: EASE }} style={{ transformPerspective: 1500 }}>
        <div className="av-product-topbar"><div className="av-window-controls"><i /><i /><i /></div><div className="av-url-bar"><ShieldCheck size={11} /> app.amaavigo.com</div><span className="av-product-live"><i /> Workspace</span><span className="av-product-avatar">A</span></div>
        <div className="av-product-app">
          <aside className="av-product-sidebar">
            <div className="av-product-wordmark"><span>A</span> amaavigo</div>
            <div className="av-side-item"><Layers size={14} /> Dashboard</div>
            <div className="av-side-item is-selected"><Inbox size={14} /> Unified Inbox <b>3</b></div>
            <div className="av-side-item"><Users size={14} /> CRM</div>
            <div className="av-side-item"><Database size={14} /> Databases</div>
            <div className="av-side-item"><Bot size={14} /> AI Agent</div>
            <div className="av-side-item"><CalendarCheck size={14} /> Scheduling</div>
            <div className="av-side-item"><Send size={14} /> Campaigns</div>
            <div className="av-side-item"><BarChart3 size={14} /> Reports</div>
            <div className="av-sidebar-bottom"><span className="av-sidebar-user">PC</span><span>Workspace</span></div>
          </aside>
          <div className="av-product-content">
            <div className="av-product-heading"><div><small>CONVERSATION MANAGEMENT</small><strong>Unified Inbox</strong></div><div className="av-product-search"><Search size={12} /> Search conversations</div><button type="button" aria-label="Notifications"><Bell size={15} /></button></div>
            <div className="av-product-filters"><span className="is-current">All conversations <b>24</b></span><span>Unread</span><span>AI active</span><span>Human handoff</span></div>
            <div className="av-product-panels">
              <div className="av-thread-list">
                <div className="av-thread-list-head"><strong>Conversations</strong><Filter size={13} /></div>
                {THREADS.map((item, index) => <button key={item.name} type="button" className={selected === index ? 'av-thread is-active' : 'av-thread'} onClick={() => setSelected(index)}>
                  <span className={'av-thread-avatar ' + item.color}>{item.initials}</span><span className="av-thread-main"><b>{item.name}</b><small>{item.preview}</small></span><span className="av-thread-time">{item.time}</span>
                </button>)}
              </div>
              <div className="av-message-panel">
                <div className="av-message-head"><span className={'av-thread-avatar ' + thread.color}>{thread.initials}</span><span><b>{thread.name}</b><small>{thread.channel} · {thread.label}</small></span><span className="av-message-status"><i /> Active</span></div>
                <div className="av-message-stream"><div className="av-message incoming">{thread.incoming}</div><AnimatePresence mode="wait"><motion.div className="av-message ai-message" key={selected} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .28 }}><span><Sparkles size={10} /> AI response</span>{thread.reply}</motion.div></AnimatePresence></div>
                <div className="av-message-composer"><span>Write a reply…</span><button type="button" aria-label="Send preview"><ArrowUpRight size={13} /></button></div>
              </div>
              <aside className="av-lead-panel"><small className="av-panel-overline">CONTACT CONTEXT</small><div className="av-lead-person"><span className={'av-lead-avatar ' + thread.color}>{thread.initials}</span><b>{thread.name}</b><small>New opportunity</small></div><div className="av-lead-fact"><small>Channel</small><b>{thread.channel}</b></div><div className="av-lead-fact"><small>Conversation status</small><b className="av-green">Active</b></div><div className="av-lead-fact"><small>Next step</small><b>Qualify enquiry</b></div><div className="av-lead-action"><CalendarCheck size={12} /> Schedule meeting</div></aside>
            </div>
          </div>
        </div>
      </motion.div>
      <motion.div className="av-hero-note av-note-one" animate={{ y: [0, -8, 0] }} transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}><span><Sparkles size={14} /></span><div><b>AI response prepared</b><small>Conversation context retained</small></div></motion.div>
      <motion.div className="av-hero-note av-note-two" animate={{ y: [0, 7, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}><span><CalendarCheck size={14} /></span><div><b>Next step connected</b><small>Meeting can be scheduled</small></div></motion.div>
      <div className="av-product-caption"><span>PRODUCT PREVIEW</span><i /> <span>INTERACTIVE CONVERSATION VIEW</span></div>
    </div>
  );
};

const JourneyVisual: React.FC<{ active: number }> = ({ active }) => {
  const step = JOURNEY_STEPS[active];
  const Icon = step.icon;
  return (
    <div className="av-journey-visual">
      <div className="av-journey-visual-top"><span><i /> CUSTOMER JOURNEY</span><span>STEP {step.number} / 05</span></div>
      <AnimatePresence mode="wait">
        <motion.div key={active} className="av-journey-stage" initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0)' }} exit={{ opacity: 0, y: -8, filter: 'blur(3px)' }} transition={{ duration: .33 }}>
          <div className="av-stage-heading"><span className="av-stage-icon"><Icon size={21} /></span><div><small>{step.short.toUpperCase()}</small><strong>{step.title}</strong></div><span className="av-stage-signal"><i /> Live preview</span></div>
          {active === 0 && <div className="av-capture-preview"><div className="av-capture-channels"><span><Globe size={15} /> Website form</span><span><MessageCircle size={15} /> WhatsApp</span><span><Mail size={15} /> Email</span></div><div className="av-capture-event"><span className="av-capture-avatar">AK</span><div><b>New enquiry received</b><small>Contact details and original source captured</small></div><BadgeCheck size={17} /></div><div className="av-capture-tags"><span>Contact created</span><span>Lead record linked</span><span>Source retained</span></div></div>}
          {active === 1 && <div className="av-chat-preview"><div className="av-chat-row"><span className="av-chat-person">AK</span><div><small>Customer · WhatsApp</small><p>I would like to know more. Can someone help me?</p></div></div><div className="av-chat-row is-ai"><span className="av-chat-ai"><Sparkles size={13} /></span><div><small>AI response</small><p>Of course. I can help with that. May I ask what you're looking to achieve?</p></div></div><div className="av-chat-state"><span><i /> AI response prepared</span><span>Human review remains available</span></div></div>}
          {active === 2 && <div className="av-qualify-preview"><div className="av-qualify-top"><span>LEAD CONTEXT</span><span className="av-intent-pill">Intent signals</span></div><div className="av-qualify-grid"><div><small>Conversation history</small><b>Questions and replies connected</b></div><div><small>Lead record</small><b>Contact details retained</b></div><div><small>Team ownership</small><b>Human handoff available</b></div><div><small>Next action</small><b>Schedule or follow up</b></div></div><div className="av-qualify-footer"><ShieldCheck size={14} /> Your team can review the context before taking over.</div></div>}
          {active === 3 && <div className="av-book-preview"><div className="av-calendar-head"><span><CalendarDays size={14} /> Available meeting times</span><small>Workspace timezone</small></div><div className="av-calendar-day"><span>MON</span><b>18</b><small>Nov</small></div><div className="av-calendar-slots"><span>10:00 AM</span><span className="is-picked">11:30 AM <Check size={11} /></span><span>2:00 PM</span><span>3:30 PM</span></div><div className="av-book-confirm"><CheckCircle2 size={14} /> Selected slot ready for confirmation</div></div>}
          {active === 4 && <div className="av-grow-preview"><div className="av-grow-cards"><div><small>CRM</small><strong>Lead record</strong><span>Stage and owner retained</span></div><div><small>FOLLOW-UP</small><strong>Next touchpoint</strong><span>Sequence can continue</span></div><div><small>REPORTING</small><strong>Campaign outcome</strong><span>Engagement and replies tracked</span></div></div><div className="av-grow-footer"><Activity size={14} /> The next interaction stays connected to the same journey.</div></div>}
        </motion.div>
      </AnimatePresence>
      <div className="av-journey-visual-bottom"><span className="av-journey-pulse" />{step.signal}<span className="av-journey-bottom-state">Preview only · Example workflow</span></div>
    </div>
  );
};

const JourneySection: React.FC = () => {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % JOURNEY_STEPS.length), 6200);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return (
    <section className="av-journey-section" id="how-it-works">
      <div className="av-container">
        <div className="av-journey-intro"><Reveal><Eyebrow>THE LEAD-TO-REVENUE JOURNEY</Eyebrow><h2>A new lead comes in.<br /><span>Amaavigo keeps it moving.</span></h2><p>Sales momentum is lost in the gaps between tools, messages and follow-ups. Amaavigo connects the steps so your team can focus on the conversations that matter.</p></Reveal></div>
        <div className="av-journey-layout">
          <div className="av-journey-steps" role="tablist" aria-label="Customer journey steps">
            {JOURNEY_STEPS.map((item, index) => { const Icon = item.icon; const selected = active === index; return <button type="button" role="tab" aria-selected={selected} key={item.number} className={selected ? 'av-journey-step is-active' : 'av-journey-step'} onClick={() => setActive(index)}><span className="av-step-number">{item.number}</span><span className="av-step-icon"><Icon size={17} /></span><span className="av-step-copy"><b>{item.title}</b><small>{item.body}</small></span><ChevronRight size={16} className="av-step-chevron" /></button>; })}
          </div>
          <Reveal className="av-journey-demo"><JourneyVisual active={active} /></Reveal>
        </div>
        <div className="av-journey-foot"><span><ShieldCheck size={15} /> Human oversight where it matters</span><span><Zap size={15} /> Connected from first touch to next step</span><span><Activity size={15} /> Context stays with the lead</span></div>
      </div>
    </section>
  );
};

const AgentSection: React.FC = () => {
  const [activePrompt, setActivePrompt] = useState(0);
  const preset = PROMPT_PRESETS[activePrompt];
  return (
    <section className="av-agent-section" id="ai-agent">
      <div className="av-agent-background" />
      <div className="av-container av-agent-layout">
        <Reveal className="av-agent-copy">
          <Eyebrow light>THE AMAAVIGO AI AGENT</Eyebrow>
          <h2>Stop moving between modules.<br /><span>Tell the agent what needs to happen.</span></h2>
          <p>From reviewing lead databases to preparing branded communication and campaign reports, the AI Agent can work across registered workspace actions—while permissions and approvals stay in place.</p>
          <div className="av-agent-prompts">{PROMPT_PRESETS.map((item, index) => <button type="button" key={item.label} className={activePrompt === index ? 'is-active' : ''} onClick={() => setActivePrompt(index)}><span>0{index + 1}</span>{item.label}<ArrowUpRight size={14} /></button>)}</div>
          <a href="/ai-agents" className="av-inline-link av-inline-link-light">Explore the AI Agent <ArrowUpRight size={15} /></a>
        </Reveal>
        <Reveal className="av-agent-demo" delay={.13}>
          <div className="av-agent-window">
            <div className="av-agent-window-head"><div className="av-agent-identity"><span><Sparkles size={15} /></span><div><b>AI Agent</b><small>Workspace assistant</small></div></div><span className="av-agent-autonomy">Balanced mode</span><button type="button" aria-label="Agent menu"><ChevronDown size={14} /></button></div>
            <div className="av-agent-context"><span>WORKSPACE CONTEXT</span><i /> Company knowledge <i /> Lead databases <i /> Campaigns</div>
            <AnimatePresence mode="wait">
              <motion.div key={activePrompt} className="av-agent-prompt-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .25 }}>
                <div><span className="av-user-bubble">You</span><small>YOUR INSTRUCTION</small></div>
                <p>{preset.prompt}</p>
              </motion.div>
            </AnimatePresence>
            <div className="av-agent-work">
              <div className="av-agent-work-title"><span><Sparkles size={13} /> PREPARING WORKFLOW</span><span className="av-agent-status"><i /> Ready to review</span></div>
              {preset.actions.map((action, index) => <motion.div key={activePrompt + '-' + action} className="av-agent-action" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .06 * index, duration: .28 }}><span className="av-agent-action-number">{String(index + 1).padStart(2, '0')}</span><span className="av-agent-action-check"><Check size={12} /></span><b>{action}</b></motion.div>)}
            </div>
            <div className="av-agent-approval"><ShieldCheck size={16} /><span><b>Approval stays with you</b><small>External actions respect permissions and require the appropriate confirmation.</small></span><span className="av-approval-pill">CONTROLLED</span></div>
            <div className="av-agent-composer"><span>Ask Amaavigo to prepare the next step…</span><button type="button" aria-label="Send prompt preview"><ArrowUpRight size={15} /></button></div>
          </div>
          <div className="av-agent-orbit av-agent-orbit-one" /><div className="av-agent-orbit av-agent-orbit-two" />
        </Reveal>
      </div>
    </section>
  );
};

const CampaignStudio: React.FC = () => {
  const [tab, setTab] = useState<'whatsapp' | 'email' | 'insights'>('whatsapp');
  return (
    <section className="av-campaign-section" id="campaigns">
      <div className="av-container">
        <div className="av-campaign-heading"><Reveal><Eyebrow>AFTER THE FIRST CONVERSATION</Eyebrow><h2>Build the campaign.<br /><span>Keep the customer context.</span></h2><p>Create communication in your own brand voice, choose the audience and understand what happened after delivery.</p><a href="/campaigns" className="av-inline-link">Explore campaigns <ArrowUpRight size={15} /></a></Reveal></div>
        <Reveal className="av-campaign-showcase" delay={.12}>
          <div className="av-campaign-top"><div><small>AMAAVIGO WORKSPACE</small><b>Campaign Studio</b></div><span className="av-campaign-top-status"><i /> Draft environment</span></div>
          <div className="av-campaign-tabs" role="tablist" aria-label="Campaign preview"><button type="button" className={tab === 'whatsapp' ? 'is-active' : ''} onClick={() => setTab('whatsapp')}><MessageCircle size={14} /> WhatsApp</button><button type="button" className={tab === 'email' ? 'is-active' : ''} onClick={() => setTab('email')}><Mail size={14} /> Email</button><button type="button" className={tab === 'insights' ? 'is-active' : ''} onClick={() => setTab('insights')}><BarChart3 size={14} /> Performance</button></div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} className="av-campaign-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: .24 }}>
              {tab === 'whatsapp' && <div className="av-whatsapp-editor"><div className="av-editor-head"><span><MessageCircle size={15} /> TEMPLATE BUILDER</span><span className="av-template-category">UTILITY · ENGLISH</span></div><div className="av-template-meta"><div><small>TEMPLATE NAME</small><b>appointment_follow_up</b></div><div><small>LANGUAGE</small><b>English (US)</b></div></div><div className="av-template-phone"><div className="av-phone-top"><span><ArrowDown size={12} /></span><b>Business message preview</b><small>WhatsApp</small></div><div className="av-phone-bubble"><strong>Your next step, made simple.</strong><p>Hello <mark>{'{{1}}'}</mark>, thanks for your enquiry. Your requested consultation details are ready. Would you like to choose a suitable time?</p><small>Example values: Ayesha · Consultation</small></div><div className="av-phone-actions"><span>Review template</span><span>Choose a time</span></div></div><div className="av-template-footer"><span><ShieldCheck size={14} /> Created in Amaavigo</span><span>Meta review required before eligible sending</span></div></div>}
              {tab === 'email' && <div className="av-email-editor"><div className="av-email-toolbar"><span><Mail size={14} /> EMAIL DESIGN STUDIO</span><span>Desktop preview</span></div><div className="av-email-canvas"><div className="av-email-brand">Your brand<span>Communication that sounds like you.</span></div><div className="av-email-hero"><small>A NOTE FROM YOUR TEAM</small><strong>A clearer next step starts here.</strong><p>Bring your customer back into the conversation with useful information and a simple way to continue.</p><span>Continue the conversation <ArrowUpRight size={12} /></span></div><div className="av-email-blocks"><i /><i /><i /></div><div className="av-email-footer">Branded email · Editable design · Campaign-ready</div></div><div className="av-email-side"><span>DESIGN BLOCKS</span><b>Brand header</b><b>Hero message</b><b>Text content</b><b>Call to action</b><b>Footer</b></div></div>}
              {tab === 'insights' && <div className="av-insights-preview"><div className="av-insights-title"><div><small>CAMPAIGN REPORT</small><b>What happened after launch</b></div><span>Example report view</span></div><div className="av-insight-metrics"><div><small>Delivery outcomes</small><b>Delivered · Bounced · Failed</b><span>Channel delivery visibility</span></div><div><small>Customer engagement</small><b>Opens · Clicks · Replies</b><span>Engagement by campaign</span></div><div><small>Sales progression</small><b>Leads · Demos · Outcomes</b><span>Tracked conversion activity</span></div></div><div className="av-chart-area"><div className="av-chart-label"><b>Engagement over time</b><span>Illustrative chart</span></div><div className="av-chart-grid"><i /><i /><i /><i /></div><div className="av-chart-bars">{[34,52,44,69,58,83,72,91,64,78,87,96].map((height, index) => <span key={index} style={{ height: height + '%' }} />)}</div></div><div className="av-report-recommendation"><Sparkles size={14} /><span><b>AI report insight</b><small>Highlight what worked, where engagement dropped and what to test next.</small></span></div></div>}
            </motion.div>
          </AnimatePresence>
        </Reveal>
      </div>
    </section>
  );
};

const WorkspaceSection: React.FC = () => (
  <section className="av-workspace-section">
    <div className="av-container">
      <Reveal className="av-section-heading"><Eyebrow>THE CONNECTED WORKSPACE</Eyebrow><h2>Everything around the sale.<br /><span>Finally working together.</span></h2><p>Each capability has a job. The value comes from what happens when they share the same customer context.</p></Reveal>
      <div className="av-capability-grid">{CAPABILITIES.map((item, index) => { const Icon = item.icon; return <Reveal key={item.title} delay={index * .055}><a href={item.href} className="av-capability-card"><div className="av-capability-top"><span className="av-capability-icon"><Icon size={19} /></span><small>{item.tag}</small></div><h3>{item.title}</h3><p>{item.copy}</p><span className="av-capability-link">Explore capability <ArrowUpRight size={14} /></span><span className="av-capability-index">0{index + 1}</span></a></Reveal>; })}</div>
    </div>
  </section>
);

const SolutionsSection: React.FC = () => (
  <section className="av-solutions-section">
    <div className="av-container av-solutions-layout">
      <Reveal><Eyebrow>BUILT FOR CUSTOMER-LED BUSINESSES</Eyebrow><h2>Different industries.<br /><span>The same need to keep leads moving.</span></h2><p>Start with the journey your team manages every day. Configure the channels, knowledge, workflows and team access around the way your business sells.</p><a href="/solutions" className="av-inline-link">Explore solutions <ArrowUpRight size={15} /></a></Reveal>
      <div className="av-solution-cards">
        <Reveal><a href="/solutions#travel" className="av-solution-card av-solution-travel"><span>01 / TRAVEL & UMRAH</span><h3>From package enquiry to consultation.</h3><p>Connect lead capture, travel questions, sales conversations and booking consultations.</p><ArrowUpRight size={17} /></a></Reveal>
        <Reveal delay={.08}><a href="/solutions#sales" className="av-solution-card av-solution-sales"><span>02 / SALES TEAMS</span><h3>From new lead to next action.</h3><p>Keep lead ownership, conversation history, qualification and demo scheduling aligned.</p><ArrowUpRight size={17} /></a></Reveal>
        <Reveal delay={.16}><a href="/solutions#service" className="av-solution-card av-solution-service"><span>03 / SERVICE BUSINESSES</span><h3>From customer request to resolution.</h3><p>Give every conversation context, a clear owner and a coordinated follow-up.</p><ArrowUpRight size={17} /></a></Reveal>
      </div>
    </div>
  </section>
);

const PricingTeaser: React.FC = () => (
  <section className="av-pricing-teaser">
    <div className="av-container av-pricing-layout">
      <Reveal><Eyebrow light>PLANS THAT FIT YOUR SALES OPERATION</Eyebrow><h2>Start with the workflow you need.<br /><span>Scale as you grow.</span></h2><p>Explore the platform capabilities, team access and usage considerations that shape an Amaavigo workspace.</p><ButtonLink href="/pricing">Explore plans & pricing</ButtonLink></Reveal>
      <Reveal className="av-pricing-visual" delay={.1}><div className="av-pricing-orbit"><i /><i /><i /></div><div className="av-pricing-core"><span>A</span><b>Your workspace</b><small>CONFIGURED AROUND YOUR TEAM</small></div><div className="av-pricing-chip chip-top">Lead operations</div><div className="av-pricing-chip chip-right">AI & automation</div><div className="av-pricing-chip chip-bottom">Campaigns & insights</div><div className="av-pricing-chip chip-left">Team & channels</div></Reveal>
    </div>
  </section>
);

const FinalCta: React.FC<{ title?: string; body?: string }> = ({ title = 'Your next customer is already trying to reach you.', body = 'Give your team one connected place to capture the enquiry, move the conversation forward and coordinate what happens next.' }) => (
  <section className="av-final-cta">
    <div className="av-final-grid" /><div className="av-final-glow" />
    <Reveal className="av-container av-final-inner"><Eyebrow light>START WITH THE CUSTOMER JOURNEY</Eyebrow><h2>{title}</h2><p>{body}</p><div><ButtonLink href={DEMO_URL} external>Book a product demo</ButtonLink><a href="/platform" className="av-final-secondary">Explore the platform <ArrowUpRight size={15} /></a></div></Reveal>
  </section>
);

const HomePage: React.FC = () => (
  <main className="av-home">
    <section className="av-hero">
      <div className="av-hero-lines" /><div className="av-hero-glow av-glow-blue" /><div className="av-hero-glow av-glow-orange" />
      <div className="av-container av-hero-layout">
        <div className="av-hero-copy">
          <Reveal><Eyebrow light>THE LEAD-TO-REVENUE PLATFORM</Eyebrow><h1>You bring in the lead.<br /><span>We keep the sale moving.</span></h1><p className="av-hero-description">Amaavigo connects lead capture, AI conversations, qualification, demo scheduling and campaigns in one workspace—so your team can stop stitching the sales process together.</p><div className="av-hero-actions"><ButtonLink href={DEMO_URL} external>See Amaavigo in action</ButtonLink><a href="#how-it-works" className="av-hero-secondary">See how it works <ArrowDown size={15} /></a></div><div className="av-hero-proof"><span><ShieldCheck size={15} /> Human control stays built in</span><i /><span><Workflow size={15} /> One connected sales journey</span></div></Reveal>
        </div>
        <HeroWorkspace />
      </div>
      <div className="av-hero-bottom"><span>CAPTURE</span><i /><span>CONVERSE</span><i /><span>QUALIFY</span><i /><span>BOOK</span><i /><span>GROW</span></div>
    </section>
    <section className="av-channel-band"><div className="av-container av-channel-inner"><div className="av-channel-label"><small>ONE CUSTOMER JOURNEY</small><b>Across the channels you use.</b></div><div className="av-channel-list"><span><MessageCircle /> WhatsApp</span><span><Mail /> Email</span><span><Globe /> Website</span><span><Users /> CRM</span><span><CalendarCheck /> Calendar</span></div></div></section>
    <JourneySection />
    <section className="av-inbox-section">
      <div className="av-container av-inbox-layout">
        <Reveal className="av-inbox-visual"><div className="av-inbox-screen"><div className="av-inbox-screen-head"><span><Inbox size={15} /> UNIFIED INBOX</span><span><i /> CONNECTED WORKSPACE</span></div><div className="av-inbox-four-panel"><div className="av-inbox-rail"><span className="is-active"><Inbox size={15} /></span><span><Users size={15} /></span><span><Bot size={15} /></span><span><Send size={15} /></span></div><div className="av-inbox-list"><small>CONVERSATIONS</small><div className="av-inbox-search"><Search size={11} /> Search contacts</div>{THREADS.map((thread, index) => <div key={thread.name} className={index === 0 ? 'av-inbox-contact is-active' : 'av-inbox-contact'}><span className={'av-thread-avatar ' + thread.color}>{thread.initials}</span><span><b>{thread.name}</b><small>{thread.preview}</small></span></div>)}</div><div className="av-inbox-thread"><div><b>Ayesha Khan</b><small>WhatsApp · New enquiry</small></div><p className="av-inbox-bubble">Hi, I would like to know more about your services.</p><p className="av-inbox-bubble is-reply"><small><Sparkles size={10} /> AI response</small>Absolutely. I can help you explore the right option and arrange the next step.</p><span className="av-inbox-input">Write a reply… <ArrowUpRight size={12} /></span></div><div className="av-inbox-profile"><small>LEAD PROFILE</small><span className="av-inbox-profile-avatar">AK</span><b>Ayesha Khan</b><em>Engaged</em><hr /><small>Lead source</small><b>WhatsApp</b><small>Next action</small><b>Qualify enquiry</b></div></div></div><div className="av-inbox-float av-float-handoff"><span><Users size={14} /></span><b>Human handoff</b></div><div className="av-inbox-float av-float-context"><span><BadgeCheck size={14} /></span><b>Lead context attached</b></div></Reveal>
        <Reveal className="av-inbox-copy"><Eyebrow>THE CONVERSATION LAYER</Eyebrow><h2>Every conversation in context.<br /><span>Not scattered across tabs.</span></h2><p>Bring supported channels into one shared Inbox. Let AI prepare responses, give people a clear way to take over and keep the lead profile beside the conversation.</p><div className="av-inbox-benefits"><div><span><MessageSquare size={16} /></span><div><b>One place to respond</b><small>Work across connected channels from a shared view.</small></div></div><div><span><Bot size={16} /></span><div><b>AI and people together</b><small>Use automatic, review or off modes, with human handoff.</small></div></div><div><span><Users size={16} /></span><div><b>Customer context stays close</b><small>Keep lead details and activity visible while your team replies.</small></div></div></div><a href="/unified-inbox" className="av-inline-link">Explore Unified Inbox <ArrowUpRight size={15} /></a></Reveal>
      </div>
    </section>
    <AgentSection />
    <CampaignStudio />
    <WorkspaceSection />
    <SolutionsSection />
    <PricingTeaser />
    <FinalCta />
  </main>
);

const CapabilityPage: React.FC<{ path: string }> = ({ path }) => {
  const page = PAGE_META[path] || PAGE_META['/platform'];
  const Icon = page.icon;
  return (
    <main className="av-subpage">
      <section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>{page.eyebrow}</Eyebrow><h1>{page.title} <span>{page.accent}</span></h1><p>{page.description}</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Talk through your workflow</ButtonLink><a href="/pricing" className="av-hero-secondary">Explore pricing <ArrowUpRight size={15} /></a></div></Reveal><Reveal className="av-subhero-product" delay={.12}><div className="av-subhero-product-orbit" /><div className="av-subhero-product-card"><div className="av-subhero-product-top"><span>A</span><div><b>{page.eyebrow}</b><small>AMAAVIGO WORKSPACE</small></div><i /></div><div className="av-subhero-icon"><Icon size={26} /></div><strong>{page.title.replace(/\.$/, '')}</strong><p>{page.description}</p><div className="av-subhero-product-footer"><span><ShieldCheck size={12} /> Connected workflow</span><ArrowUpRight size={14} /></div></div></Reveal></div></section>
      <section className="av-subpage-points"><div className="av-container av-subpage-points-layout"><Reveal><Eyebrow>WHAT YOU CAN DO</Eyebrow><h2>Designed around the work.<br /><span>Connected to the outcome.</span></h2><p>Every capability works as part of the wider customer journey, with context and control carried from one step to the next.</p></Reveal><Reveal className="av-subpage-point-list" delay={.1}>{page.points.map((point, index) => <div key={point}><span>{String(index + 1).padStart(2, '0')}</span><b>{point}</b><Check size={15} /></div>)}</Reveal></div></section>
      <section className="av-subpage-next"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>CONNECTED BY DESIGN</Eyebrow><h2>The next step is already <span>part of the same workspace.</span></h2></Reveal><div className="av-subpage-next-grid">{page.next.map((item, index) => <Reveal key={item.title} delay={index * .07}><a href={item.href} className="av-next-card"><span>0{index + 1}</span><b>{item.title}</b><p>{item.copy}</p><ArrowUpRight size={16} /></a></Reveal>)}</div></div></section>
      <FinalCta title="See how the whole journey works together." body="Walk through the platform with our team and map the right lead-to-revenue workflow for your business." />
    </main>
  );
};

const SolutionsPage: React.FC = () => (
  <main className="av-subpage">
    <section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>SOLUTIONS</Eyebrow><h1>Built around the way your business <span>turns interest into action.</span></h1><p>Start with the sales journey your team manages every day. Configure your channels, knowledge, people and workflows around it.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Talk to our team</ButtonLink><a href="/platform" className="av-hero-secondary">Explore the platform <ArrowUpRight size={15} /></a></div></Reveal><Reveal className="av-subhero-product" delay={.12}><div className="av-solutions-orbit"><span><Globe /></span><span><MessageCircle /></span><span><CalendarCheck /></span><span><Users /></span><div>A</div></div></Reveal></div></section>
    <section className="av-solution-details"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>WORKFLOWS, NOT INDUSTRY STEREOTYPES</Eyebrow><h2>Different businesses.<br /><span>The same need for momentum.</span></h2></Reveal><div className="av-solution-detail-grid"><article id="travel"><small>01 / TRAVEL & UMRAH OPERATORS</small><span><Globe size={22} /></span><h3>From package enquiry to consultation.</h3><p>Centralise travel enquiries, answer common questions using configured knowledge, coordinate follow-up and schedule a consultation with the right person.</p><a href="/lead-capture">Explore lead capture <ArrowUpRight size={15} /></a></article><article id="sales"><small>02 / SALES TEAMS</small><span><Users size={22} /></span><h3>From new lead to next action.</h3><p>Keep lead ownership, customer conversations, qualification, demo booking and campaign follow-through in one place.</p><a href="/crm">Explore CRM <ArrowUpRight size={15} /></a></article><article id="service"><small>03 / SERVICE BUSINESSES</small><span><Headphones size={22} /></span><h3>From customer request to resolution.</h3><p>Give each request context, a clear conversation owner and a coordinated follow-up, with AI assistance where it fits.</p><a href="/unified-inbox">Explore Unified Inbox <ArrowUpRight size={15} /></a></article></div></div></section>
    <FinalCta />
  </main>
);

const PricingPage: React.FC = () => (
  <main className="av-subpage av-pricing-page">
    <section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>PLANS & PRICING</Eyebrow><h1>Choose the capabilities that move your <span>sales operation forward.</span></h1><p>Pricing should reflect the team, channels and usage you actually need. We’ll help map the right workspace configuration for your business.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Request plan details</ButtonLink><a href="/platform" className="av-hero-secondary">Explore platform <ArrowUpRight size={15} /></a></div></Reveal><Reveal className="av-subhero-product"><div className="av-pricing-stack"><div><small>WORKSPACE FOUNDATION</small><b>Leads · Inbox · CRM</b><span><Check size={13} /> One connected operating view</span></div><div><small>SALES AUTOMATION</small><b>AI · Follow-up · Scheduling</b><span><Check size={13} /> Workflows with human control</span></div><div><small>ENGAGEMENT & INSIGHTS</small><b>Campaigns · WhatsApp · Reports</b><span><Check size={13} /> Create, send and learn</span></div></div></Reveal></div></section>
    <section className="av-pricing-details"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>A PLAN THAT FITS YOUR WORKFLOW</Eyebrow><h2>Start with your sales process.<br /><span>Build the right workspace around it.</span></h2><p>Rather than showing unverified prices or feature limits, we’ll confirm the current plan, allowances and available integrations against your actual requirements.</p></Reveal><div className="av-pricing-models"><article><small>01 / FOUNDATION</small><h3>Capture & organise</h3><p>For teams bringing inbound enquiries, conversations and lead records into one operating view.</p><ul><li><Check /> Lead capture and CRM</li><li><Check /> Unified Inbox</li><li><Check /> Lead databases</li><li><Check /> Workspace and team setup</li></ul><a href={DEMO_URL} target="_blank" rel="noreferrer">Discuss this setup <ArrowUpRight size={14} /></a></article><article className="is-featured"><span className="av-model-tag">SALES AUTOMATION</span><small>02 / GROWTH</small><h3>Qualify & convert</h3><p>For teams bringing AI assistance, follow-up and demo scheduling into the customer journey.</p><ul><li><Check /> Everything in Foundation</li><li><Check /> AI Agent and handoff modes</li><li><Check /> Automated follow-up</li><li><Check /> Demo scheduling</li></ul><a href={DEMO_URL} target="_blank" rel="noreferrer">Discuss this setup <ArrowUpRight size={14} /></a></article><article><small>03 / ENGAGEMENT</small><h3>Campaigns & insights</h3><p>For teams managing branded communication, larger audiences and campaign reporting.</p><ul><li><Check /> Email Design Studio</li><li><Check /> WhatsApp Template Studio</li><li><Check /> Campaigns and audience snapshots</li><li><Check /> Campaign reports and AI insights</li></ul><a href={DEMO_URL} target="_blank" rel="noreferrer">Discuss this setup <ArrowUpRight size={14} /></a></article></div><div className="av-pricing-transparency"><ShieldCheck size={18} /><div><b>Clear usage. No made-up allowances.</b><p>Final subscription pricing and entitlements are confirmed from the current workspace plan configuration. AI costs depend on the models and actual tokens used. WhatsApp provider charges are separate and subject to Meta’s current pricing and account setup.</p></div></div></div></section>
    <FinalCta title="Let’s find the right setup for your sales process." body="Tell us how leads arrive, how your team responds and what you want to automate. We’ll map the right Amaavigo workspace." />
  </main>
);

const IntegrationsPage: React.FC = () => (
  <main className="av-subpage"><section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>INTEGRATIONS</Eyebrow><h1>Bring your customer channels into <span>one operating view.</span></h1><p>Connect the messaging, email, calendar and website services your team already uses, subject to provider permissions and eligibility.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Discuss your integrations</ButtonLink></div></Reveal><Reveal className="av-integration-constellation"><div className="av-integration-core">A</div>{[{icon:MessageCircle,label:'WhatsApp',pos:'wa'},{icon:Mail,label:'Email',pos:'email'},{icon:Globe,label:'Website',pos:'web'},{icon:CalendarCheck,label:'Calendar',pos:'calendar'},{icon:Workflow,label:'Webhooks',pos:'hooks'}].map((item) => {const Icon=item.icon;return <span className={'av-integration-node node-' + item.pos} key={item.label}><Icon size={17}/><b>{item.label}</b></span>;})}</Reveal></div></section><section className="av-integration-list"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>CONNECTED SERVICES</Eyebrow><h2>Work with the channels<br /><span>your customers already know.</span></h2></Reveal><div className="av-integration-grid">{[{icon:MessageCircle,name:'WhatsApp Business',copy:'Supported WhatsApp Business connections and template workflows.'},{icon:Mail,name:'Email',copy:'Connected mailboxes, email sending and campaign communication.'},{icon:Globe,name:'Website',copy:'Website enquiries, forms and chatbot/webhook workflows.'},{icon:CalendarCheck,name:'Google Calendar',copy:'Calendar availability, events and Google Meet scheduling.'},{icon:CalendarClock,name:'Microsoft 365',copy:'Outlook calendar and Teams meeting workflows where configured.'},{icon:Workflow,name:'Webhooks & APIs',copy:'Connect supported external systems to inbound and outbound workflows.'}].map((item,index)=>{const Icon=item.icon;return <Reveal key={item.name} delay={index*.05}><div className="av-integration-card"><span><Icon size={20}/></span><b>{item.name}</b><p>{item.copy}</p></div></Reveal>;})}</div></div></section><FinalCta /></main>
);

const ResourcesPage: React.FC = () => (
  <main className="av-subpage"><section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>RESOURCES</Eyebrow><h1>Understand the workflow behind <span>better sales momentum.</span></h1><p>Practical product guides and answers for teams connecting lead capture, conversations, AI and campaigns.</p><div className="av-subhero-actions"><ButtonLink href="/platform">Explore the platform</ButtonLink></div></Reveal><Reveal className="av-resource-hero-card"><span><Command size={20}/></span><small>THE AMAAVIGO METHOD</small><b>Capture → Converse → Qualify → Book → Grow</b><p>One connected journey. One operating workspace.</p></Reveal></div></section><section className="av-resource-section"><div className="av-container"><div className="av-resource-grid"><a href="/lead-capture"><Globe/><small>LEAD CAPTURE</small><b>Bring every enquiry into the same workspace.</b><span>Explore guide <ArrowUpRight size={14}/></span></a><a href="/unified-inbox"><Inbox/><small>CONVERSATIONS</small><b>Work across connected channels from one Inbox.</b><span>Explore guide <ArrowUpRight size={14}/></span></a><a href="/ai-agents"><Bot/><small>AI AGENT</small><b>Prepare multi-step work through natural language.</b><span>Explore guide <ArrowUpRight size={14}/></span></a><a href="/campaigns"><Send/><small>CAMPAIGNS</small><b>Create, send and understand customer engagement.</b><span>Explore guide <ArrowUpRight size={14}/></span></a></div></div></section><section className="av-faq-section" id="faqs"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>FREQUENTLY ASKED QUESTIONS</Eyebrow><h2>Clear answers before <span>you get started.</span></h2></Reveal><div className="av-faq-list"><details><summary>What is Amaavigo? <ChevronDown size={17}/></summary><p>Amaavigo is a connected lead-to-revenue workspace that brings together lead capture, customer conversations, AI assistance, CRM, demo scheduling, campaigns and reporting.</p></details><details><summary>Does Amaavigo automatically handle every conversation? <ChevronDown size={17}/></summary><p>Conversation automation depends on the channel's configured operating mode, permissions, available knowledge and handoff rules. Teams can use automatic, review or off modes where supported.</p></details><details><summary>Can the AI Agent create campaigns and WhatsApp templates? <ChevronDown size={17}/></summary><p>The AI Agent can prepare supported template previews and campaign drafts. Saving, external submission and dispatch remain subject to permissions and the required approvals.</p></details><details><summary>Can I create my own WhatsApp templates? <ChevronDown size={17}/></summary><p>Yes. Amaavigo includes a WhatsApp template workflow for creating and managing drafts. Meta approval is still required before a template can be used in eligible outbound messaging.</p></details><details><summary>Which calendar providers can I connect? <ChevronDown size={17}/></summary><p>The current scheduling module supports Google Calendar and Microsoft 365 connection flows, subject to account access and configuration.</p></details><details><summary>How is pricing calculated? <ChevronDown size={17}/></summary><p>Plan entitlements and usage allowances depend on the configured workspace plan. AI usage costs depend on the models and actual token usage; WhatsApp provider charges are separate.</p></details></div></div></section><FinalCta /></main>
);

const AboutPage: React.FC = () => (
  <main className="av-subpage"><section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>ABOUT AMAAVIGO</Eyebrow><h1>Make the work behind every customer relationship <span>feel connected.</span></h1><p>Amaavigo Digital Solutions LLP is building a connected workspace for the people, conversations and workflows that move a business from enquiry to growth.</p><div className="av-subhero-actions"><ButtonLink href="/contact">Talk to our team</ButtonLink></div></Reveal><Reveal className="av-about-mark"><span>A</span><b>One connected journey.</b><small>CAPTURE · CONVERSE · CONVERT</small></Reveal></div></section><section className="av-about-content"><div className="av-container av-about-content-layout"><Reveal><Eyebrow>OUR PRODUCT BELIEF</Eyebrow><h2>Software should connect the work.<br /><span>Not create another place to manage it.</span></h2></Reveal><Reveal><p>Customer acquisition and sales follow-through often happen across different tools. A new enquiry arrives in one channel, a response is written somewhere else, lead data lives in another system and the next meeting has to be coordinated separately.</p><p>Amaavigo is being built around the idea that these steps should work together. The customer context should stay connected from the first enquiry through the next action.</p></Reveal></div></section><FinalCta /></main>
);

const ContactPage: React.FC = () => (
  <main className="av-subpage"><section className="av-subhero"><div className="av-hero-lines" /><div className="av-subhero-glow" /><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>CONTACT & PRODUCT DEMO</Eyebrow><h1>Show us how your sales process works. <span>We’ll map the next step.</span></h1><p>Tell us how enquiries arrive, how your team responds and which parts you want to automate. We’ll walk through the relevant Amaavigo workflows with you.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Open demo request form</ButtonLink><a href="/pricing" className="av-hero-secondary">Explore plans <ArrowUpRight size={15} /></a></div></Reveal><Reveal className="av-contact-card"><span><CalendarCheck size={22}/></span><small>PRODUCT WALKTHROUGH</small><b>From first enquiry to booked meeting.</b><p>Review lead capture, AI conversations, demo scheduling and campaigns in one connected product walkthrough.</p><div><CheckCircle2 size={14}/> Discuss your workflow</div><div><CheckCircle2 size={14}/> Explore channels and integrations</div><div><CheckCircle2 size={14}/> Review plans and usage</div></Reveal></div></section><FinalCta title="Let’s make your sales process easier to run." body="Book a walkthrough and show us the workflow you want Amaavigo to take care of." /></main>
);

export const LandingPage: React.FC = () => {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/' : '/';
  const pageName: Record<string, string> = {
    '/': 'Lead-to-Revenue Platform', '/platform': 'Platform', '/lead-capture': 'Lead Capture',
    '/unified-inbox': 'Unified Inbox', '/ai-agents': 'AI Agent', '/ai-agent': 'AI Agent',
    '/crm': 'CRM & Lead Databases', '/demo-scheduling': 'Demo Scheduling', '/campaigns': 'Campaigns',
    '/whatsapp': 'WhatsApp Template Studio', '/analytics': 'Analytics & Reporting',
    '/integrations': 'Integrations', '/solutions': 'Solutions', '/pricing': 'Plans & Pricing',
    '/resources': 'Resources', '/about': 'About', '/contact': 'Contact', '/book-demo': 'Book a Demo',
  };
  const title = pageName[pathname] || pageName['/'];
  useEffect(() => {
    document.title = title + ' | Amaavigo';
    let description = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!description) { description = document.createElement('meta'); description.name = 'description'; document.head.appendChild(description); }
    description.content = 'Amaavigo connects lead capture, AI conversations, qualification, demo scheduling, campaigns and reporting in one lead-to-revenue workspace.';
  }, [title]);

  let page: React.ReactNode;
  if (pathname === '/pricing') page = <PricingPage />;
  else if (pathname === '/solutions') page = <SolutionsPage />;
  else if (pathname === '/integrations') page = <IntegrationsPage />;
  else if (pathname === '/resources') page = <ResourcesPage />;
  else if (pathname === '/about') page = <AboutPage />;
  else if (pathname === '/contact' || pathname === '/book-demo') page = <ContactPage />;
  else if (PAGE_META[pathname] || pathname === '/ai-agent') page = <CapabilityPage path={pathname === '/ai-agent' ? '/ai-agents' : pathname} />;
  else page = <HomePage />;

  return <div className="av-site"><SiteHeader pathname={pathname} />{page}<SiteFooter /></div>;
};

export default LandingPage;
