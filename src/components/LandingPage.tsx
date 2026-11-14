import React, { useEffect, useState } from 'react';
import { FEATURES, LIMITS } from '../shared/features';
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
  Instagram,
  Facebook,
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
  {label:'Platform',href:'/platform',links:[
    {label:'Platform overview',href:'/platform',description:'One workspace for the full lead-to-revenue journey'},
    {label:'Lead capture',href:'/lead-capture',description:'Bring enquiries from every connected source'},
    {label:'Unified Inbox',href:'/unified-inbox',description:'WhatsApp, Instagram, Messenger, email and web'},
    {label:'AI Agent',href:'/ai-agents',description:'Prepare work across the workspace from one prompt'},
    {label:'Built-in CRM',href:'/crm',description:'Manage contacts, ownership, stages and databases'},
    {label:'Campaign Builder',href:'/campaigns',description:'Create branded email and WhatsApp campaigns'},
    {label:'Demo scheduling',href:'/demo-scheduling',description:'Turn buying intent into a booked meeting'},
    {label:'Analytics & reports',href:'/analytics',description:'Understand engagement and sales progression'},
  ]},
  {label:'Solutions',href:'/solutions',links:[
    {label:'Lead generation teams',href:'/solutions#lead-generation',description:'Capture, qualify and follow up consistently'},
    {label:'Sales organisations',href:'/solutions#sales-teams',description:'Keep conversations, pipeline and campaigns connected'},
    {label:'Customer operations',href:'/solutions#customer-operations',description:'Coordinate service conversations and next steps'},
  ]},
  {label:'Resources',href:'/resources',links:[
    {label:'How it works',href:'/resources#how-it-works',description:'See the complete lead-to-revenue workflow'},
    {label:'Integrations',href:'/integrations',description:'Connect the tools your team already uses'},
    {label:'FAQs',href:'/resources#faqs',description:'Answers about channels, AI and campaigns'},
  ]},
];

const CAPABILITIES: Array<{icon:LucideIcon;title:string;copy:string;href:string;tag:string}> = [
  {icon:Globe,title:'Lead capture',copy:'Bring website enquiries, connected social and messaging channels, and imported prospects into one workspace.',href:'/lead-capture',tag:'ATTRACT'},
  {icon:Inbox,title:'Unified Inbox',copy:'Manage WhatsApp, Instagram, Facebook Messenger, email and website conversations in one shared view.',href:'/unified-inbox',tag:'ENGAGE'},
  {icon:Bot,title:'AI Agent',copy:'Describe a task in plain language and prepare work across your connected workspace.',href:'/ai-agents',tag:'AUTOMATE'},
  {icon:Users,title:'Built-in CRM',copy:'Keep lead records, ownership, pipeline stages, notes and activity connected.',href:'/crm',tag:'ORGANISE'},
  {icon:Send,title:'Campaign Builder',copy:'Design branded email and WhatsApp campaigns, select audiences and track engagement.',href:'/campaigns',tag:'CONVERT'},
  {icon:CalendarCheck,title:'Demo scheduling',copy:'Coordinate calendar availability and move qualified conversations to a confirmed meeting.',href:'/demo-scheduling',tag:'BOOK'},
  {icon:BarChart3,title:'Analytics & reports',copy:'Understand delivery, engagement, replies, tracked meetings and campaign outcomes.',href:'/analytics',tag:'GROW'},
];

const THREADS = [
  {name:'Ayesha Khan',initials:'AK',color:'mint',channel:'WhatsApp',time:'Now',preview:'I would like to know more about your services.',incoming:'Hi, I found your website and would like to understand how your service works.',reply:'Welcome, Ayesha. I can help with that. May I ask what your team is currently using to manage new enquiries?',status:'AI reply drafted',label:'New enquiry'},
  {name:'Imran Patel',initials:'IP',color:'blue',channel:'Instagram',time:'4m',preview:'Could someone share more details?',incoming:'I saw your recent post. Could someone share more details?',reply:'Absolutely. I can help with that and connect you with the right person if needed.',status:'Intent detected',label:'Social enquiry'},
  {name:'Sara Merchant',initials:'SM',color:'peach',channel:'Messenger',time:'12m',preview:'Can we arrange a quick call?',incoming:'Could we arrange a quick call to discuss the next step?',reply:'Of course. I can help coordinate a suitable time for your team.',status:'Meeting intent detected',label:'Needs attention'},
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
    eyebrow: 'PLATFORM OVERVIEW', title: 'The complete sales workspace', accent: 'for growing businesses.', description: 'Capture demand, manage every conversation, run campaigns, organise your customer pipeline and understand performance — all in one connected platform.',
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
    eyebrow: 'UNIFIED INBOX', title: 'Every conversation.', accent: 'One intelligent Inbox.', description: 'Manage WhatsApp, Instagram, Facebook Messenger, email and website conversations in one shared view, with AI assistance, human handoff and customer context.',
    icon: Inbox, points: ['WhatsApp, email, website and supported social conversations', 'Conversation views, search and status filters', 'AI, review and off operating modes', 'Human handoff, ownership and conversation controls', 'Lead profile and activity alongside messages'],
    next: [{ title: 'AI-assisted replies', copy: 'Let the agent prepare the next response.', href: '/ai-agents' }, { title: 'Lead context', copy: 'Keep records and conversations together.', href: '/crm' }, { title: 'Schedule the next step', copy: 'Turn interest into a meeting.', href: '/demo-scheduling' }],
  },
  '/ai-agents': {
    eyebrow: 'AMAAVIGO AI AGENT', title: 'Describe the outcome. Let the agent prepare the work.', accent: 'You stay in control.', description: 'Use one conversational workspace to research, organise, draft and prepare actions across connected Amaavigo modules—with permissions and approval boundaries intact.',
    icon: Bot, points: ['Research public company branding and configured knowledge', 'Review available lead databases and campaign templates', 'Prepare email and WhatsApp template previews', 'Prepare campaign drafts and campaign reports', 'Respect workspace permissions and explicit approval for external actions'],
    next: [{ title: 'Create communication', copy: 'Build branded email and WhatsApp drafts.', href: '/campaigns' }, { title: 'Organise leads', copy: 'Use lead databases and CRM context.', href: '/crm' }, { title: 'Measure results', copy: 'Turn campaign data into an action plan.', href: '/analytics' }],
  },
  '/crm': {
    eyebrow: 'BUILT-IN CRM', title: 'Keep every lead organised.', accent: 'Keep every opportunity moving.', description: 'Manage contact records, pipeline stages, ownership, notes, activities and follow-ups in a built-in CRM. Keep separate lead databases ready for campaign audiences.',
    icon: Users, points: ['Lead and contact records in a shared workspace', 'Pipeline stages, status and ownership', 'Lead database collections and import history', 'Duplicate handling and audience organisation', 'Conversation and follow-up context close to the record'],
    next: [{ title: 'Bring leads in', copy: 'Capture and import new enquiries.', href: '/lead-capture' }, { title: 'Work the conversation', copy: 'Reply with the right context.', href: '/unified-inbox' }, { title: 'Reach the right audience', copy: 'Build a campaign from a saved database.', href: '/campaigns' }],
  },
  '/demo-scheduling': {
    eyebrow: 'DEMO SCHEDULING', title: 'Turn buying intent into a confirmed time.', accent: 'Without the back-and-forth.', description: 'Connect a calendar, configure working hours and session duration, and coordinate bookings from the customer conversation.',
    icon: CalendarCheck, points: ['Google Calendar and Microsoft 365 connections', 'Working days, hours, timezone and session duration', 'Calendar availability and booking management', 'Google Meet or Microsoft Teams meeting links', 'Scheduling agent simulation and conversation context'],
    next: [{ title: 'Qualify the enquiry', copy: 'Use AI and the conversation context.', href: '/ai-agents' }, { title: 'Keep the lead record', copy: 'Track progress inside CRM.', href: '/crm' }, { title: 'Measure the outcome', copy: 'Review campaign and booking activity.', href: '/analytics' }],
  },
  '/campaigns': {
    eyebrow: 'CAMPAIGN BUILDER', title: 'Create, send and grow.', accent: 'With campaigns that convert.', description: 'Design branded email and WhatsApp campaigns, create your own WhatsApp templates, select audiences, coordinate follow-ups and understand what happened after delivery.',
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
    icon: Workflow, points: ['WhatsApp Business conversations and template workflows', 'Instagram messaging and Facebook Messenger', 'Email inboxes and sending connections', 'Website forms and inbound lead workflows', 'Google Calendar, Microsoft 365, APIs and supported webhooks'],
    next: [{ title: 'Manage conversations', copy: 'Work across connected channels.', href: '/unified-inbox' }, { title: 'Coordinate meetings', copy: 'Connect calendars and demo availability.', href: '/demo-scheduling' }, { title: 'Capture enquiries', copy: 'Bring forms and inbound leads together.', href: '/lead-capture' }],
  },
};

const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className, delay = 0 }) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 38, scale: .965, filter: 'blur(7px)' }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: reduced ? 0 : .88, delay: reduced ? 0 : delay, ease: EASE }}
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
          <a href="/platform" onClick={() => setMobileOpen(false)}>Platform</a><a href="/lead-capture" onClick={() => setMobileOpen(false)}>Lead capture</a><a href="/unified-inbox" onClick={() => setMobileOpen(false)}>Unified Inbox</a><a href="/ai-agents" onClick={() => setMobileOpen(false)}>AI Agent</a><a href="/crm" onClick={() => setMobileOpen(false)}>Built-in CRM</a><a href="/demo-scheduling" onClick={() => setMobileOpen(false)}>Demo scheduling</a><a href="/campaigns" onClick={() => setMobileOpen(false)}>Campaign Builder</a><a href="/solutions" onClick={() => setMobileOpen(false)}>Solutions</a><a href="/integrations" onClick={() => setMobileOpen(false)}>Integrations</a><a href="/pricing" onClick={() => setMobileOpen(false)}>Pricing</a><a href="/resources" onClick={() => setMobileOpen(false)}>Resources</a><a href="/about" onClick={() => setMobileOpen(false)}>About</a><a href="/login" onClick={() => setMobileOpen(false)}>Log in</a>
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
      <div className="av-footer-col"><strong>Engagement</strong><a href="/campaigns">Campaign Builder</a><a href="/whatsapp">WhatsApp templates</a><a href="/analytics">Analytics & reporting</a><a href="/integrations">Integrations</a><a href="/solutions">Solutions</a></div>
      <div className="av-footer-col"><strong>Company</strong><a href="/pricing">Pricing</a><a href="/resources">Resources & FAQs</a><a href="/about">About Amaavigo</a><a href="/contact">Contact</a><a href="/login">Log in</a></div>
      <div className="av-footer-col"><strong>Legal</strong><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/dpa">Data Processing Agreement</a><a href="/aup">Acceptable Use & AI Policy</a></div>
    </div>
    <div className="av-footer-bottom"><span>© {new Date().getFullYear()} Amaavigo Digital Solutions LLP. All rights reserved.</span><span>Lead capture → conversation → conversion.</span></div>
  </footer>
);

const HeroWorkspace: React.FC = () => {
 const reduced=useReducedMotion();
 return <div className="av-hero-product av-hero-product-showcase"><div className="av-hero-product-glow"/>
  <motion.div className="av-hero-product-window" initial={reduced?false:{opacity:0,y:28,rotateY:-8,scale:.96}} animate={{opacity:1,y:0,rotateY:0,scale:1}} transition={{duration:reduced?0:1.05,delay:.12,ease:EASE}} style={{transformPerspective:1500}}>
   <div className="av-hero-browser-bar"><span className="av-browser-dots"><i/><i/><i/></span><span className="av-browser-address"><ShieldCheck size={10}/> app.amaavigo.com</span><span className="av-browser-live"><i/> LIVE WORKSPACE</span></div>
   <div className="av-hero-product-ui">
    <aside className="av-product-sidebar"><div className="av-product-brand"><span>A</span><b>amaavigo</b></div><div className="av-product-nav"><span><Layers size={13}/> Dashboard</span><span className="is-active"><Inbox size={13}/> Unified Inbox</span><span><Users size={13}/> CRM</span><span><Sparkles size={13}/> AI Agent</span><span><Send size={13}/> Campaigns</span><span><CalendarCheck size={13}/> Scheduling</span><span><BarChart3 size={13}/> Analytics</span></div><div className="av-product-sidebar-foot"><span><Database size={12}/> Databases</span><span><ShieldCheck size={12}/> Workspace</span></div></aside>
    <div className="av-product-conversations"><div className="av-product-workspace-title"><small>CONVERSATION MANAGEMENT</small><b>Unified Inbox</b></div><div className="av-product-tabs"><span className="is-active">All conversations <i>24</i></span><span>AI active <i>16</i></span><span>Human handoff <i>4</i></span></div>{THREADS.map((thread,index)=><div key={thread.name} className={index===0?'av-product-thread-row is-active':'av-product-thread-row'}><span className={'av-product-avatar '+thread.color}>{thread.initials}</span><span className="av-product-thread-info"><b>{thread.name}</b><small>{thread.preview}</small></span><span className="av-product-thread-meta">{thread.time}</span></div>)}<div className="av-product-channel-footer"><span><MessageCircle/> WhatsApp</span><span><Instagram/> Instagram</span><span><Facebook/> Messenger</span><span><Mail/> Email</span></div></div>
    <div className="av-product-conversation-view"><div className="av-product-contact-head"><span className="av-product-avatar mint">AK</span><span><b>Ayesha Khan</b><small>WhatsApp · New enquiry</small></span><i>● Active</i></div><div className="av-product-message is-customer">Hi, I would like to understand how your service works. Can you share more details?</div><div className="av-product-message is-ai"><small><Sparkles size={10}/> AI RESPONSE PREPARED</small>Absolutely. I can help you explore the right option and arrange the next step.</div><div className="av-product-booking"><span><CalendarCheck size={15}/></span><span><b>Book a demo</b><small>Choose a time that works for you</small></span><ArrowUpRight size={13}/></div><div className="av-product-composer">Write a message… <span><ArrowUpRight size={13}/></span></div></div>
    <aside className="av-product-contact-context"><small>CONTACT CONTEXT</small><span className="av-context-avatar">AK</span><b>Ayesha Khan</b><em>New opportunity</em><div><small>CHANNEL</small><b>WhatsApp</b></div><div><small>LEAD STATUS</small><b>New enquiry</b></div><div><small>NEXT STEP</small><b>Qualify & schedule</b></div></aside>
   </div>
  </motion.div>
  <div className="av-hero-channel-stack"><motion.span className="av-hero-channel whatsapp" animate={reduced?{y:0}:{y:[0,-7,0]}} transition={{duration:4.4,repeat:Infinity,ease:'easeInOut'}}><MessageCircle size={23}/></motion.span><motion.span className="av-hero-channel instagram" animate={reduced?{y:0}:{y:[0,6,0]}} transition={{duration:5.1,delay:.25,repeat:Infinity,ease:'easeInOut'}}><Instagram size={23}/></motion.span><motion.span className="av-hero-channel messenger" animate={reduced?{y:0}:{y:[0,-5,0]}} transition={{duration:4.8,delay:.5,repeat:Infinity,ease:'easeInOut'}}><Facebook size={23}/></motion.span><motion.span className="av-hero-channel email" animate={reduced?{y:0}:{y:[0,6,0]}} transition={{duration:5.5,delay:.75,repeat:Infinity,ease:'easeInOut'}}><Mail size={23}/></motion.span><motion.span className="av-hero-channel website" animate={reduced?{y:0}:{y:[0,-6,0]}} transition={{duration:4.9,delay:1,repeat:Infinity,ease:'easeInOut'}}><Globe size={22}/></motion.span></div>
  <motion.div className="av-hero-float-card av-hero-ai-float" animate={reduced?{y:0}:{y:[0,-8,0]}} transition={{duration:5.8,repeat:Infinity,ease:'easeInOut'}}><span><Sparkles size={17}/></span><div><b>AI Agent</b><small>Qualifying a new lead…</small></div><i/></motion.div>
  <motion.div className="av-hero-float-card av-hero-booked-float" animate={reduced?{y:0}:{y:[0,7,0]}} transition={{duration:5.2,delay:.35,repeat:Infinity,ease:'easeInOut'}}><span><CalendarCheck size={18}/></span><div><b>Demo booked</b><small>Next step confirmed</small></div><CheckCircle2 size={15}/></motion.div>
  <div className="av-hero-spark av-hero-spark-one">✳</div><div className="av-hero-spark av-hero-spark-two">✳</div>
 </div>;
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
  const reduced = useReducedMotion();
  return (
    <section className="av-campaign-section" id="campaigns">
      <div className="av-container">
        <div className="av-campaign-heading"><Reveal>
          <div className="av-campaign-artwork">
            <motion.div className="av-campaign-art-scene" animate={reduced ? { y: 0 } : { y: [0, -7, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
              <div className="av-campaign-art-toolbar"><span><Mail size={13}/></span><span><MessageCircle size={13}/></span><span><Workflow size={13}/></span><span><BarChart3 size={13}/></span></div>
              <div className="av-campaign-art-email"><small>YOUR BRAND</small><div className="av-campaign-art-gradient"><Sparkles size={23}/></div><b>Make the next conversation count.</b><i/><i/><span>Continue <ArrowUpRight size={10}/></span></div>
              <div className="av-campaign-art-side"><span><CheckCircle2 size={12}/> Audience ready</span><span><CheckCircle2 size={12}/> Content prepared</span><span><CheckCircle2 size={12}/> Tracking enabled</span></div>
            </motion.div>
            <motion.span className="av-campaign-art-chip av-campaign-art-chip-one" animate={reduced ? { y: 0 } : { y: [0, -6, 0] }} transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}><Sparkles size={12} /> Brand-ready creative</motion.span>
            <motion.span className="av-campaign-art-chip av-campaign-art-chip-two" animate={reduced ? { y: 0 } : { y: [0, 5, 0] }} transition={{ duration: 5.6, delay: .4, repeat: Infinity, ease: 'easeInOut' }}><CheckCircle2 size={12} /> Audience connected</motion.span>
          </div>
          <Eyebrow>AFTER THE FIRST CONVERSATION</Eyebrow>
          <h2>Build campaigns that turn conversations <span>into customers.</span></h2><p>Create branded email and WhatsApp campaigns, design your own templates, choose an audience, automate follow-ups and track what happened after delivery.</p>
          <a href="/campaigns" className="av-inline-link">Explore campaigns <ArrowUpRight size={15} /></a>
        </Reveal></div>
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

const RevenueEngineSection: React.FC = () => (
 <section className="av-revenue-suite"><div className="av-revenue-suite-glow"/><div className="av-container av-revenue-layout">
  <Reveal className="av-revenue-intro"><Eyebrow light>THE COMPLETE SALES WORKSPACE</Eyebrow><h2>Everything you need to move from enquiry <span>to revenue.</span></h2><p>Capture demand, keep every conversation moving, manage relationships, launch campaigns and understand what drives your next customer.</p><div className="av-revenue-points"><span><CheckCircle2 size={14}/> Omnichannel conversations</span><span><CheckCircle2 size={14}/> AI agent & automation</span><span><CheckCircle2 size={14}/> Built-in CRM & lead databases</span><span><CheckCircle2 size={14}/> Email & WhatsApp campaigns</span><span><CheckCircle2 size={14}/> Demo scheduling & reporting</span></div><a href="/platform" className="av-revenue-link">Explore the platform <ArrowUpRight size={15}/></a></Reveal>
  <div className="av-revenue-card-grid">
   <Reveal delay={.05}><a href="/campaigns" className="av-revenue-card av-revenue-campaign"><div className="av-revenue-card-head"><span><Send size={15}/> CAMPAIGN BUILDER</span><ArrowUpRight size={14}/></div><b>Create campaigns that feel like your brand.</b><div className="av-revenue-editor"><div className="av-revenue-editor-tools"><span>T</span><span><Layers size={11}/></span><span>▤</span><span>↗</span></div><div className="av-revenue-email-preview"><small>YOUR BRAND · EMAIL CAMPAIGN</small><strong>Make the next conversation count.</strong><i/><i/><span>Continue the journey <ArrowUpRight size={10}/></span></div><div className="av-revenue-wa-pill"><MessageCircle size={12}/> WhatsApp template</div></div><div className="av-revenue-card-foot"><span>Visual email design</span><span>Custom WhatsApp templates</span></div></a></Reveal>
   <Reveal delay={.12}><a href="/crm" className="av-revenue-card av-revenue-crm"><div className="av-revenue-card-head"><span><Users size={15}/> BUILT-IN CRM</span><ArrowUpRight size={14}/></div><b>Keep every lead and next step connected.</b><div className="av-revenue-pipeline"><div><small>NEW LEADS</small><span>AK</span><span>IP</span><span>SM</span></div><div><small>IN PROGRESS</small><span>RA</span><span>NK</span></div><div><small>DEMO BOOKED</small><span>ZS</span><span>FK</span></div></div><div className="av-revenue-database"><Database size={13}/><span><b>Lead databases</b><small>Reusable audiences for campaigns</small></span><CheckCircle2 size={13}/></div><div className="av-revenue-card-foot"><span>Pipeline & ownership</span><span>Lead activity history</span></div></a></Reveal>
   <Reveal delay={.19}><a href="/analytics" className="av-revenue-card av-revenue-analytics"><div className="av-revenue-card-head"><span><BarChart3 size={15}/> REVENUE GROWTH INSIGHTS</span><ArrowUpRight size={14}/></div><b>Know what moves the numbers.</b><div className="av-revenue-chart"><div className="av-revenue-chart-label"><span>Campaign engagement</span><small>Example view</small></div><svg viewBox="0 0 260 100" role="img" aria-label="Illustrative upward engagement trend"><path d="M0 79H260M0 52H260M0 25H260" stroke="#E5EAF4" strokeDasharray="3 5"/><path d="M4 76C24 71 31 62 48 67S78 57 94 54 123 62 143 42 173 48 191 26 223 32 256 8" stroke="#155EEF" strokeWidth="3" strokeLinecap="round" fill="none"/><path d="M4 76C24 71 31 62 48 67S78 57 94 54 123 62 143 42 173 48 191 26 223 32 256 8V100H4Z" fill="url(#avRevenueFill)" opacity=".16"/><defs><linearGradient id="avRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#155EEF"/><stop offset="1" stopColor="#155EEF" stopOpacity="0"/></linearGradient></defs></svg><div className="av-revenue-chart-bars">{[30,48,42,65,52,76,68,92].map((v,i)=><i key={i} style={{height:v+'%'}}/>)}</div></div><div className="av-revenue-card-foot"><span>Delivery & engagement</span><span>Replies & tracked outcomes</span></div></a></Reveal>
  </div>
 </div></section>
);

const CrmSpotlight: React.FC = () => (
 <section className="av-crm-spotlight"><div className="av-container av-crm-spotlight-layout">
  <Reveal className="av-crm-spotlight-copy"><Eyebrow>YOUR BUILT-IN CRM</Eyebrow><h2>Not another contact list.<br/><span>A clearer way to move every lead.</span></h2><p>Keep contact details, conversations, ownership, pipeline stages, notes and the next action together. Add separate lead databases to organise campaign audiences without mixing them into your CRM.</p><div className="av-crm-benefits"><span><Check size={14}/> Lead profiles and conversation history</span><span><Check size={14}/> Pipeline stages and team ownership</span><span><Check size={14}/> Follow-up tasks and activity timeline</span><span><Check size={14}/> Separate reusable lead databases</span></div><a href="/crm" className="av-inline-link">Explore the built-in CRM <ArrowUpRight size={15}/></a></Reveal>
  <Reveal className="av-crm-board" delay={.1}><div className="av-crm-board-top"><span><Users size={14}/> SALES PIPELINE</span><span>Example workspace view <i/></span></div><div className="av-crm-board-summary"><div><small>CONTACTS</small><b>Lead records</b></div><div><small>PIPELINE</small><b>Stage tracking</b></div><div><small>ACTIVITY</small><b>Next actions</b></div></div>
   <div className="av-crm-kanban"><div className="av-crm-lane lane-new"><header>New enquiry <i>03</i></header>{[['AK','Ayesha Khan','Website form'],['IP','Imran Patel','Instagram'],['SM','Sara Merchant','WhatsApp']].map(x=><div className="av-crm-person" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><small>{x[2]}</small></div>)}</div><div className="av-crm-lane lane-progress"><header>In progress <i>02</i></header>{[['RA','Rizwan Ali','Qualification'],['NK','Neha Kapoor','Follow-up']].map(x=><div className="av-crm-person" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><small>{x[2]}</small></div>)}</div><div className="av-crm-lane lane-booked"><header>Demo booked <i>02</i></header>{[['ZS','Zeeshan Khan','Demo confirmed'],['FK','Farhan Khan','Next step']].map(x=><div className="av-crm-person" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><small>{x[2]}</small></div>)}</div></div>
   <div className="av-crm-database-strip"><Database size={15}/><span><b>Lead databases</b><small>Organise audiences · review imports · snapshot campaign recipients</small></span><ArrowUpRight size={15}/></div>
  </Reveal>
 </div></section>
);

const WorkspaceSection: React.FC = () => (
 <section className="av-workspace-section"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>THE CONNECTED WORKSPACE</Eyebrow><h2>One platform. Every step<br/><span>working toward the next customer.</span></h2><p>Seven connected capabilities. One shared context from the first enquiry through campaigns, meetings and reporting.</p></Reveal>
  <div className="av-capability-grid">{CAPABILITIES.map((item,index)=>{const Icon=item.icon;return <Reveal key={item.title} delay={index*.045}><a href={item.href} className="av-capability-card"><div className="av-capability-top"><span className="av-capability-icon"><Icon size={19}/></span><small>{item.tag}</small></div><h3>{item.title}</h3><p>{item.copy}</p><span className="av-capability-link">Explore capability <ArrowUpRight size={14}/></span><span className="av-capability-index">0{index+1}</span></a></Reveal>;})}</div>
 </div></section>
);

const SolutionsSection: React.FC = () => (
 <section className="av-solutions-section"><div className="av-container av-solutions-layout"><Reveal><Eyebrow>FOR CUSTOMER-LED TEAMS</Eyebrow><h2>Built for the way your business <span>finds and grows customers.</span></h2><p>Whether your team handles inbound enquiries, relationship-led sales or ongoing customer operations, Amaavigo connects the work from first touch to next step.</p><a href="/solutions" className="av-inline-link">Explore solutions <ArrowUpRight size={15}/></a></Reveal>
  <div className="av-solution-cards"><Reveal><a href="/solutions#lead-generation" className="av-solution-card av-solution-leadgen"><span>01 / LEAD GENERATION</span><h3>Turn more enquiries into qualified opportunities.</h3><p>Bring leads from every connected source into one organised workflow.</p><ArrowUpRight size={17}/></a></Reveal><Reveal delay={.08}><a href="/solutions#sales-teams" className="av-solution-card av-solution-sales"><span>02 / SALES TEAMS</span><h3>Keep every opportunity moving forward.</h3><p>Connect conversations, CRM ownership, campaigns and demo scheduling.</p><ArrowUpRight size={17}/></a></Reveal><Reveal delay={.16}><a href="/solutions#customer-operations" className="av-solution-card av-solution-service"><span>03 / CUSTOMER OPERATIONS</span><h3>Give every customer a clear next step.</h3><p>Keep requests, responses, context and follow-up coordinated as relationships grow.</p><ArrowUpRight size={17}/></a></Reveal></div>
 </div></section>
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
  <section className="av-hero"><div className="av-hero-lines"/><div className="av-hero-glow av-glow-blue"/><div className="av-hero-glow av-glow-orange"/>
   <div className="av-container av-hero-layout"><div className="av-hero-copy"><Reveal><Eyebrow>THE AI-POWERED LEAD-TO-REVENUE PLATFORM</Eyebrow><h1>You bring in the lead.<br/>We turn it into a <span>booked sale.</span></h1><p className="av-hero-description">Capture leads from every connected channel. Let AI handle conversations, keep every relationship in your built-in CRM, launch campaigns and turn customer intent into booked meetings — all from one intelligent workspace.</p><div className="av-hero-actions"><ButtonLink href={DEMO_URL} external>See Amaavigo in action</ButtonLink><a href="/platform" className="av-hero-secondary"><span className="av-play-icon">▶</span> Explore the platform</a></div><div className="av-hero-proof"><span><ShieldCheck size={15}/> Human control stays built in</span><i/><span><Workflow size={15}/> One connected sales journey</span></div></Reveal></div><HeroWorkspace/></div>
   <div className="av-hero-journey-strip"><div><span className="step-capture"><MousePointerClickFallback/></span><b>Capture</b><small>Leads from every channel</small></div><ArrowRight size={18}/><div><span className="step-engage"><Sparkles size={19}/></span><b>Engage</b><small>AI handles the conversation</small></div><ArrowRight size={18}/><div><span className="step-book"><CalendarCheck size={19}/></span><b>Book</b><small>Schedule demos automatically</small></div><ArrowRight size={18}/><div><span className="step-grow"><BarChart3 size={19}/></span><b>Grow</b><small>Run campaigns & track results</small></div></div>
   <div className="av-hero-bottom"><span>CAPTURE</span><i/><span>ENGAGE</span><i/><span>BOOK</span><i/><span>GROW</span></div>
  </section>
  <section className="av-channel-band"><div className="av-container av-channel-inner"><div className="av-channel-label"><small>ONE CUSTOMER JOURNEY</small><b>Wherever your customers start.</b></div><div className="av-channel-list"><span><MessageCircle/> WhatsApp</span><span><Instagram/> Instagram</span><span><Facebook/> Messenger</span><span><Mail/> Email</span><span><Globe/> Website</span></div></div></section>
  <RevenueEngineSection/><JourneySection/>
  <section className="av-inbox-section"><div className="av-container av-inbox-layout">
   <Reveal className="av-inbox-visual"><div className="av-inbox-screen"><div className="av-inbox-screen-head"><span><Inbox size={15}/> UNIFIED INBOX</span><span><i/> CONNECTED CHANNELS</span></div><div className="av-inbox-four-panel"><div className="av-inbox-rail"><span className="is-active"><Inbox size={15}/></span><span><Users size={15}/></span><span><Bot size={15}/></span><span><Send size={15}/></span></div><div className="av-inbox-list"><small>CONVERSATIONS</small><div className="av-inbox-search"><Search size={11}/> Search contacts</div>{THREADS.map((thread,index)=><div key={thread.name} className={index===0?'av-inbox-contact is-active':'av-inbox-contact'}><span className={'av-thread-avatar '+thread.color}>{thread.initials}</span><span><b>{thread.name}</b><small>{thread.channel} · {thread.preview}</small></span></div>)}</div><div className="av-inbox-thread"><div><b>Ayesha Khan</b><small>WhatsApp · New enquiry</small></div><p className="av-inbox-bubble">Hi, I would like to understand how your service works.</p><p className="av-inbox-bubble is-reply"><small><Sparkles size={10}/> AI response</small>Of course. I can help you explore the right option and arrange the next step.</p><span className="av-inbox-input">Write a reply… <ArrowUpRight size={12}/></span></div><div className="av-inbox-profile"><small>LEAD PROFILE</small><span className="av-inbox-profile-avatar">AK</span><b>Ayesha Khan</b><em>New opportunity</em><hr/><small>Channel</small><b>WhatsApp</b><small>Next action</small><b>Qualify enquiry</b></div></div></div><div className="av-inbox-float av-float-handoff"><span><Users size={14}/></span><b>Human handoff</b></div><div className="av-inbox-float av-float-context"><span><BadgeCheck size={14}/></span><b>Lead context attached</b></div></Reveal>
   <Reveal className="av-inbox-copy"><Eyebrow>THE CONVERSATION LAYER</Eyebrow><h2>Every conversation.<br/><span>One intelligent Inbox.</span></h2><p>Bring customer conversations from WhatsApp, Instagram, Facebook Messenger, email and website into one shared view. Let AI prepare replies, give your team a clear way to take over and keep every lead profile beside the conversation.</p><div className="av-inbox-benefits"><div><span><MessageSquare size={16}/></span><div><b>All channels in one place</b><small>See messages and customer context without switching tools.</small></div></div><div><span><Bot size={16}/></span><div><b>AI and people together</b><small>Choose automatic, review or off modes with human handoff.</small></div></div><div><span><Users size={16}/></span><div><b>Lead context stays close</b><small>Keep ownership, notes and activity visible while replying.</small></div></div></div><a href="/unified-inbox" className="av-inline-link">Explore Unified Inbox <ArrowUpRight size={15}/></a></Reveal>
  </div></section>
  <AgentSection/><CampaignStudio/><CrmSpotlight/><WorkspaceSection/><SolutionsSection/><PricingTeaser/>
  <FinalCta title="Turn the next enquiry into your next customer." body="Give your team one connected place to capture demand, handle conversations, manage relationships and keep revenue moving."/>
 </main>
);
const MousePointerClickFallback: React.FC = () => <Globe size={19}/>;

const FeatureIllustration: React.FC<{path:string}> = ({path}) => {
 const channels=<div className="av-feature-channels"><span className="wa"><MessageCircle/></span><span className="ig"><Instagram/></span><span className="fb"><Facebook/></span><span className="mail"><Mail/></span><span className="web"><Globe/></span></div>;
 if(path==='/lead-capture') return <div className="av-feature-illustration av-feature-lead-capture">
  <div className="av-feature-window-head"><span><i/><i/><i/></span><b>Lead Capture</b><small>New enquiry received</small></div>
  <div className="av-feature-lead-sources"><span><Globe/> Website</span><span><MessageCircle/> WhatsApp</span><span><Instagram/> Instagram</span><span><Facebook/> Messenger</span><span><Mail/> Email</span></div>
  <div className="av-feature-form-preview"><div className="av-feature-form-top"><span><Sparkles size={13}/> NEW ENQUIRY</span><b>Let’s start a conversation.</b><small>Your details are captured and routed to the right workspace.</small></div>
   <div className="av-feature-form-fields"><span>Name</span><span>Work email</span><span>Phone number</span><div>Send enquiry <ArrowUpRight size={11}/></div></div>
  </div>
  <div className="av-feature-inbox-foot"><Database size={13}/> Contact captured · Source retained · CRM record created</div>
 </div>;
 if(path==='/unified-inbox') return <div className="av-feature-illustration av-feature-inbox"><div className="av-feature-window-head"><span><i/><i/><i/></span><b>Unified Inbox</b><small>Live conversation view</small></div>{channels}<div className="av-feature-inbox-ui"><div className="av-feature-inbox-list"><small>CONVERSATIONS</small><b className="active">Ayesha Khan <i>WhatsApp</i></b><b>Imran Patel <i>Instagram</i></b><b>Sara Merchant <i>Messenger</i></b></div><div className="av-feature-inbox-chat"><b>Ayesha Khan <i>● Active</i></b><p>Can you share more details?</p><p className="ai"><Sparkles size={11}/> AI response prepared</p><span>Write a reply…</span></div></div><div className="av-feature-inbox-foot"><ShieldCheck size={13}/> Human handoff · Lead profile · Conversation history</div></div>;
 if(path==='/campaigns'||path==='/whatsapp') return <div className="av-feature-illustration av-feature-campaign"><div className="av-feature-window-head"><span><i/><i/><i/></span><b>Campaign Builder</b><small>Draft preview</small></div><div className="av-feature-campaign-tabs"><span className="selected"><Mail size={11}/> Email</span><span><MessageCircle size={11}/> WhatsApp</span><span><Workflow size={11}/> Follow-up</span></div><div className="av-feature-campaign-workspace"><div className="av-feature-toolrail"><i>T</i><i><Layers size={11}/></i><i>▤</i><i>↗</i></div><div className="av-feature-email-card"><small>YOUR BRAND</small><div className="av-feature-email-image"><Sparkles size={22}/></div><h4>Make the next conversation count.</h4><p>A helpful message, a clear next step, and a way to keep the relationship moving.</p><span>Continue <ArrowUpRight size={10}/></span></div><div className="av-feature-sequence"><b>FOLLOW-UP JOURNEY</b><i>Send campaign</i><i>Wait for engagement</i><i>Prepare next touch</i></div></div><div className="av-feature-inbox-foot"><Layers size={13}/> Visual design · Custom templates · Audience selection · Reporting</div></div>;
 if(path==='/crm') return <div className="av-feature-illustration av-feature-crm"><div className="av-feature-window-head"><span><i/><i/><i/></span><b>Built-in CRM</b><small>Pipeline overview</small></div><div className="av-feature-crm-summary"><span><small>CONTACTS</small><b>Lead records</b></span><span><small>PIPELINE</small><b>Stage tracking</b></span><span><small>ACTIVITY</small><b>Next actions</b></span></div><div className="av-feature-crm-board"><div><b>New leads</b><i>AK · Ayesha Khan</i><i>IP · Imran Patel</i><i>SM · Sara Merchant</i></div><div><b>In progress</b><i>RA · Rizwan Ali</i><i>NK · Neha Kapoor</i></div><div><b>Demo booked</b><i>ZS · Zeeshan Khan</i><i>FK · Farhan Khan</i></div></div><div className="av-feature-inbox-foot"><Database size={13}/> Separate lead databases · Import history · Campaign snapshots</div></div>;
 if(path==='/ai-agents'||path==='/ai-agent') return <div className="av-feature-illustration av-feature-agent"><div className="av-feature-agent-label"><Sparkles size={15}/> AMAAVIGO AI AGENT <i>Balanced mode</i></div><div className="av-feature-agent-prompt">“Prepare a follow-up campaign for leads who haven't booked, and show me the draft.”</div>{['Review recent lead activity','Find the right audience','Prepare campaign content','Create a draft for approval'].map((x,i)=><div className="av-feature-agent-step" key={x}><span><Check size={12}/></span>{x}<small>{String(i+1).padStart(2,'0')}</small></div>)}<div className="av-feature-agent-approval"><ShieldCheck size={14}/> You stay in control of external actions.</div></div>;
 if(path==='/demo-scheduling') return <div className="av-feature-illustration av-feature-scheduling"><div className="av-feature-window-head"><span><i/><i/><i/></span><b>Demo Scheduling</b><small>Calendar availability</small></div><div className="av-feature-calendar"><div><small>WORKSPACE CALENDAR</small><b>November 2026</b><div className="av-feature-calendar-days">{['M','T','W','T','F','S','S'].map((x,i)=><i key={i}>{x}</i>)}{Array.from({length:28},(_,i)=><i key={'d'+i} className={i===17?'selected':''}>{i+1}</i>)}</div></div><div className="av-feature-calendar-slots"><small>AVAILABLE TIMES</small><b>10:00 AM</b><b>11:30 AM</b><b className="selected">2:00 PM</b><b>3:30 PM</b><span>Confirm booking <ArrowUpRight size={11}/></span></div></div><div className="av-feature-inbox-foot"><CalendarCheck size={13}/> Google Calendar · Microsoft 365 · Meeting links</div></div>;
 if(path==='/integrations') return <div className="av-feature-illustration av-feature-integrations"><div className="av-feature-integrations-core">a</div>{channels}<div className="av-feature-integration-name">Connected channels & tools</div><div className="av-feature-integration-bottom"><span>Google Calendar</span><span>Microsoft 365</span><span>Website forms</span><span>APIs & webhooks</span></div></div>;
 if(path==='/analytics') return <div className="av-feature-illustration av-feature-analytics"><div className="av-feature-window-head"><span><i/><i/><i/></span><b>Growth Insights</b><small>Campaign reporting</small></div><div className="av-feature-kpi"><span><small>DELIVERY</small><b>Campaign outcomes</b></span><span><small>ENGAGEMENT</small><b>Opens · Clicks · Replies</b></span><span><small>CONVERSION</small><b>Tracked next steps</b></span></div><div className="av-feature-analytics-chart"><div><i/><i/><i/><i/></div><svg viewBox="0 0 400 130" role="img" aria-label="Illustrative campaign engagement chart"><path d="M0 103 C35 91 41 72 72 83 S115 99 142 59 S188 81 218 54 S266 63 287 32 S340 48 400 8" stroke="#155EEF" strokeWidth="4" fill="none" strokeLinecap="round"/></svg></div><div className="av-feature-inbox-foot"><Sparkles size={13}/> AI-generated findings and recommendations</div></div>;
 return <div className="av-feature-illustration av-feature-platform"><div className="av-feature-platform-orbit"/><div className="av-feature-platform-core">a</div><span className="node node-leads"><Globe/> Lead capture</span><span className="node node-inbox"><Inbox/> Unified Inbox</span><span className="node node-ai"><Sparkles/> AI Agent</span><span className="node node-crm"><Users/> CRM</span><span className="node node-campaign"><Send/> Campaigns</span><span className="node node-analytics"><BarChart3/> Insights</span></div>;
};

const CapabilityPage: React.FC<{path:string}> = ({path}) => {
 const page=PAGE_META[path]||PAGE_META['/platform'];
 return <main className="av-subpage"><section className="av-subhero av-capability-hero"><div className="av-hero-lines"/><div className="av-subhero-glow"/><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>{page.eyebrow}</Eyebrow><h1>{page.title} <span>{page.accent}</span></h1><p>{page.description}</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Book a product demo</ButtonLink><a href="/pricing" className="av-hero-secondary">Explore pricing <ArrowUpRight size={15}/></a></div><div className="av-page-proof"><span><CheckCircle2 size={13}/> Connected customer context</span><span><ShieldCheck size={13}/> Human control built in</span></div></Reveal><Reveal className="av-subhero-product av-feature-visual-wrap" delay={.12}><FeatureIllustration path={path}/></Reveal></div></section><section className="av-subpage-points"><div className="av-container av-subpage-points-layout"><Reveal><Eyebrow>WHAT YOU CAN DO</Eyebrow><h2>Designed around the work.<br/><span>Connected to the outcome.</span></h2><p>Every capability works as part of the wider customer journey, with context and control carried from one step to the next.</p></Reveal><Reveal className="av-subpage-point-list" delay={.1}>{page.points.map((point,index)=><div key={point}><span>{String(index+1).padStart(2,'0')}</span><b>{point}</b><Check size={15}/></div>)}</Reveal></div></section><section className="av-subpage-next"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>CONNECTED BY DESIGN</Eyebrow><h2>The next step is already <span>part of the same workspace.</span></h2></Reveal><div className="av-subpage-next-grid">{page.next.map((item,index)=><Reveal key={item.title} delay={index*.07}><a href={item.href} className="av-next-card"><span>0{index+1}</span><b>{item.title}</b><p>{item.copy}</p><ArrowUpRight size={16}/></a></Reveal>)}</div></div></section><FinalCta title="See how the whole journey works together." body="Walk through the platform and map the right lead-to-revenue workflow for your team."/></main>;
};

const SolutionsPage: React.FC = () => (
 <main className="av-subpage av-solutions-page"><section className="av-subhero av-solutions-hero"><div className="av-hero-lines"/><div className="av-subhero-glow"/><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>AMAAVIGO SOLUTIONS</Eyebrow><h1>One connected way to <span>find, win and grow customers.</span></h1><p>Give every team a clearer process for capturing demand, managing conversations, coordinating the sales pipeline and building stronger customer relationships.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Book a product demo</ButtonLink><a href="/platform" className="av-hero-secondary">Explore the platform <ArrowUpRight size={15}/></a></div></Reveal><Reveal className="av-solutions-hero-visual"><div className="av-solutions-visual-orbit"/><div className="av-solutions-visual-core">a</div><span><Globe/> Capture</span><span><MessageCircle/> Engage</span><span><Users/> Organise</span><span><BarChart3/> Grow</span></Reveal></div></section>
 <section className="av-solution-details"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>BUILT AROUND YOUR WORKFLOW</Eyebrow><h2>Different teams. <span>One connected growth engine.</span></h2><p>Start with the work your team needs to make easier. Add connected capabilities as your process grows.</p></Reveal><div className="av-solution-detail-grid"><article id="lead-generation"><small>01 / LEAD GENERATION</small><span><Globe size={22}/></span><h3>Turn more enquiries into qualified opportunities.</h3><p>Bring website forms, WhatsApp, Instagram, Messenger, email and imported lead lists into one organised workspace.</p><a href="/lead-capture">Explore lead capture <ArrowUpRight size={15}/></a></article><article id="sales-teams"><small>02 / SALES TEAMS</small><span><Users size={22}/></span><h3>Move every opportunity toward its next step.</h3><p>Give teams a shared Inbox, a built-in CRM, clear ownership, campaign follow-through and demo scheduling.</p><a href="/crm">Explore CRM <ArrowUpRight size={15}/></a></article><article id="customer-operations"><small>03 / CUSTOMER OPERATIONS</small><span><Headphones size={22}/></span><h3>Keep customer requests connected to outcomes.</h3><p>Coordinate conversations, knowledge, handoffs and next actions so no customer request gets lost between tools.</p><a href="/unified-inbox">Explore Unified Inbox <ArrowUpRight size={15}/></a></article></div></div></section>
 <FinalCta title="Build a sales process that keeps moving." body="See how Amaavigo can connect the way your team captures, engages, manages and grows customer relationships."/></main>
);

interface PublicPricingPlan {
  id: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  sortOrder: number;
}
interface PublicPricingCatalog {
  plans: PublicPricingPlan[];
}

const PricingPage: React.FC = () => {
  const [plans, setPlans] = useState<PublicPricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/public/plans', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Could not load plans');
        return data as PublicPricingCatalog;
      })
      .then((data) => {
        if (!active) return;
        setPlans(Array.isArray(data.plans) ? data.plans.filter(Boolean).sort((a, b) => a.sortOrder - b.sortOrder) : []);
        setLoadError('');
      })
      .catch((error: any) => {
        if (active) setLoadError(error?.message || 'Could not load current plans.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const formatPrice = (plan: PublicPricingPlan) => {
    if (!plan.priceMonthly) return 'Free';
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: plan.currency || 'USD',
        maximumFractionDigits: 0,
      }).format(plan.priceMonthly);
    } catch {
      return (plan.currency || '') + ' ' + Number(plan.priceMonthly).toLocaleString('en-IN');
    }
  };

  return (
    <main className="av-subpage av-pricing-page">
      <section className="av-subhero">
        <div className="av-hero-lines" /><div className="av-subhero-glow" />
        <div className="av-container av-subhero-layout">
          <Reveal>
            <Eyebrow light>PLANS & PRICING</Eyebrow>
            <h1>Choose the capabilities that move your <span>sales operation forward.</span></h1>
            <p>Transparent plans, managed centrally and kept up to date as Amaavigo evolves. Compare the capabilities and allowances available to your team.</p>
            <div className="av-subhero-actions">
              <ButtonLink href="/contact">Talk to our team</ButtonLink>
              <a href="/platform" className="av-hero-secondary">Explore platform <ArrowUpRight size={15} /></a>
            </div>
          </Reveal>
          <Reveal className="av-subhero-product">
            <div className="av-pricing-stack">
              <div><small>WORKSPACE FOUNDATION</small><b>Leads · Inbox · CRM</b><span><Check size={13} /> One connected operating view</span></div>
              <div><small>SALES AUTOMATION</small><b>AI · Follow-up · Scheduling</b><span><Check size={13} /> Workflows with human control</span></div>
              <div><small>ENGAGEMENT & INSIGHTS</small><b>Campaigns · WhatsApp · Reports</b><span><Check size={13} /> Create, send and learn</span></div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="av-pricing-details av-live-pricing">
        <div className="av-container">
          <Reveal className="av-section-heading">
            <Eyebrow>THE AMAAVIGO PLANS</Eyebrow>
            <h2>One connected platform.<br /><span>A plan for your next stage.</span></h2>
            <p>These plans are published directly from the live platform catalog. Feature access and usage allowances reflect the configuration maintained by our Super Admin team.</p>
          </Reveal>

          {loading ? (
            <div className="av-live-plan-grid" aria-label="Loading plans">
              {[0, 1, 2].map((item) => <div className="av-live-plan-skeleton" key={item}><i /><i /><i /><i /><i /></div>)}
            </div>
          ) : loadError ? (
            <div className="av-live-plan-message">
              <b>We couldn’t load the latest plans.</b>
              <p>Please refresh this page or contact our team for current pricing.</p>
              <a href="/contact">Contact Amaavigo <ArrowUpRight size={14} /></a>
            </div>
          ) : plans.length === 0 ? (
            <div className="av-live-plan-message">
              <b>Plans are being configured.</b>
              <p>Our team can help you find the right setup for your sales operation.</p>
              <a href="/contact">Talk to our team <ArrowUpRight size={14} /></a>
            </div>
          ) : (
            <div className="av-live-plan-grid">
              {plans.map((plan) => {
                const includedFeatures = FEATURES.filter((feature) => plan.features?.[feature.key] ?? feature.defaultEnabled);
                const includedLimits = LIMITS.filter((limit) => plan.limits?.[limit.key] !== undefined);
                return (
                  <article className="av-live-plan-card" key={plan.id}>
                    <div className="av-live-plan-topline"><span>AMAAVIGO PLAN</span><i /></div>
                    <h3>{plan.name}</h3>
                    <div className="av-live-plan-price">
                      <strong>{formatPrice(plan)}</strong>
                      <span>{plan.priceMonthly ? 'per month' : 'free plan'}</span>
                    </div>
                    <p className="av-live-plan-summary">A connected workspace with capabilities and allowances configured for this plan.</p>
                    <div className="av-live-plan-divider" />
                    <div className="av-live-plan-label">INCLUDED CAPABILITIES</div>
                    <ul className="av-live-plan-features">
                      {includedFeatures.map((feature) => (
                        <li key={feature.key}><CheckCircle2 size={15} /><span>{feature.label}</span></li>
                      ))}
                    </ul>
                    <div className="av-live-plan-divider" />
                    <div className="av-live-plan-label">USAGE ALLOWANCES</div>
                    {includedLimits.length > 0 ? (
                      <ul className="av-live-plan-limits">
                        {includedLimits.map((limit) => (
                          <li key={limit.key}><span>{limit.label}</span><b>{Number(plan.limits[limit.key]).toLocaleString('en-IN')} <small>{limit.unit}</small></b></li>
                        ))}
                      </ul>
                    ) : (
                      <p className="av-live-plan-no-limits">Usage allowances are configured with your workspace.</p>
                    )}
                    <a className="av-live-plan-cta" href="/contact">Discuss this plan <ArrowUpRight size={15} /></a>
                  </article>
                );
              })}
            </div>
          )}

          <div className="av-pricing-transparency">
            <ShieldCheck size={18} />
            <div>
              <b>Clear usage. No made-up allowances.</b>
              <p>Plan prices, included capabilities and limits are read from the same catalog managed in the Platform Console. AI costs depend on actual model and token usage. WhatsApp provider charges are separate and subject to Meta’s current pricing and account setup.</p>
            </div>
          </div>
        </div>
      </section>
      <FinalCta title="Let’s find the right setup for your sales process." body="Tell us how leads arrive, how your team responds and what you want to automate. We’ll map the right Amaavigo workspace." />
    </main>
  );
};

const IntegrationsPage: React.FC = () => (
 <main className="av-subpage av-integrations-page"><section className="av-subhero"><div className="av-hero-lines"/><div className="av-subhero-glow"/><div className="av-container av-subhero-layout"><Reveal><Eyebrow light>CONNECTED CHANNELS & TOOLS</Eyebrow><h1>Bring your customer channels into <span>one operating view.</span></h1><p>Meet customers on the channels they use, connect the calendars your team relies on, and keep the customer context together inside Amaavigo.</p><div className="av-subhero-actions"><ButtonLink href={DEMO_URL} external>Discuss your integrations</ButtonLink><a href="/unified-inbox" className="av-hero-secondary">Explore Unified Inbox <ArrowUpRight size={15}/></a></div></Reveal><Reveal className="av-integration-constellation"><div className="av-integration-core">a</div><span className="av-integration-node node-wa"><MessageCircle/><b>WhatsApp</b></span><span className="av-integration-node node-instagram"><Instagram/><b>Instagram</b></span><span className="av-integration-node node-messenger"><Facebook/><b>Messenger</b></span><span className="av-integration-node node-email"><Mail/><b>Email</b></span><span className="av-integration-node node-web"><Globe/><b>Website</b></span><span className="av-integration-node node-calendar"><CalendarCheck/><b>Calendar</b></span></Reveal></div></section>
 <section className="av-integration-list"><div className="av-container"><Reveal className="av-section-heading"><Eyebrow>YOUR CONNECTED ECOSYSTEM</Eyebrow><h2>Where conversations start.<br/><span>Where the next step gets booked.</span></h2><p>Connect supported channels and services through the relevant account permissions and provider setup.</p></Reveal><div className="av-integration-grid">{[{icon:MessageCircle,name:'WhatsApp Business',copy:'Connect WhatsApp Business and manage eligible customer conversations and template workflows.'},{icon:Instagram,name:'Instagram Messaging',copy:'Bring supported Instagram conversations into the shared customer Inbox.'},{icon:Facebook,name:'Facebook Messenger',copy:'Manage supported Messenger conversations with the same customer context.'},{icon:Mail,name:'Email',copy:'Connect business mailboxes and use email for customer conversations and campaigns.'},{icon:Globe,name:'Website & forms',copy:'Capture website enquiries and connect supported form and webhook workflows.'},{icon:CalendarCheck,name:'Google Calendar',copy:'Check calendar availability and coordinate demo bookings and meeting links.'},{icon:CalendarClock,name:'Microsoft 365',copy:'Connect Outlook calendar and Microsoft Teams meeting workflows where configured.'},{icon:Workflow,name:'APIs & webhooks',copy:'Connect supported external systems to inbound and outbound workflows.'}].map((item,index)=>{const Icon=item.icon;return <Reveal key={item.name} delay={index*.045}><div className="av-integration-card"><span><Icon size={20}/></span><b>{item.name}</b><p>{item.copy}</p></div></Reveal>;})}</div><div className="av-integration-note"><ShieldCheck size={15}/> Available connections depend on provider permissions, workspace configuration and account eligibility.</div></div></section><FinalCta/></main>
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
