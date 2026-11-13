import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Globe,
  Instagram,
  Layers,
  LockKeyhole,
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

type NavLink = { label: string; href: string; note?: string };
type FeatureCard = { icon: LucideIcon; title: string; body: string; href: string; tone?: string };

const navGroups: Array<{ label: string; href: string; links: NavLink[] }> = [
  {
    label: 'Platform',
    href: '/platform',
    links: [
      { label: 'Platform overview', href: '/platform', note: 'One connected growth workspace' },
      { label: 'Unified Inbox', href: '/unified-inbox', note: 'Every customer conversation together' },
      { label: 'AI Agents', href: '/ai-agents', note: 'AI assistance with human control' },
      { label: 'CRM & Lead Management', href: '/crm', note: 'Organise every opportunity' },
      { label: 'Campaigns & Automation', href: '/campaigns', note: 'Keep engagement moving' },
    ],
  },
  {
    label: 'Solutions',
    href: '/solutions',
    links: [
      { label: 'Travel & Umrah operators', href: '/solutions', note: 'Manage enquiries through booking' },
      { label: 'Sales teams', href: '/solutions#sales-teams', note: 'Give every lead a next step' },
      { label: 'Service businesses', href: '/solutions#service-businesses', note: 'Coordinate customer operations' },
    ],
  },
  {
    label: 'Resources',
    href: '/resources',
    links: [
      { label: 'How it works', href: '/resources#how-it-works', note: 'Understand the lead journey' },
      { label: 'Integrations', href: '/integrations', note: 'Connect your existing tools' },
      { label: 'FAQs', href: '/resources#faqs', note: 'Answers about the platform' },
    ],
  },
];

const features: FeatureCard[] = [
  { icon: MessageSquare, title: 'Unified Inbox', body: 'Bring WhatsApp, email, social and website conversations into one shared operating view.', href: '/unified-inbox', tone: 'blue' },
  { icon: Bot, title: 'AI Agents', body: 'Draft replies, understand intent and move conversations forward with human oversight.', href: '/ai-agents', tone: 'violet' },
  { icon: Users, title: 'CRM & Lead Management', body: 'Keep people, pipeline stages, ownership and conversation history connected.', href: '/crm', tone: 'orange' },
  { icon: Send, title: 'Campaigns', body: 'Plan outbound engagement and keep campaign activity connected to lead records.', href: '/campaigns', tone: 'blue' },
  { icon: Database, title: 'Lead Databases', body: 'Organise prospect lists into reusable databases for targeted campaign workflows.', href: '/crm', tone: 'violet' },
  { icon: Workflow, title: 'Automation', body: 'Coordinate follow-ups and repetitive steps without losing visibility or control.', href: '/ai-agents', tone: 'orange' },
  { icon: CalendarCheck, title: 'Demo Scheduling', body: 'Connect availability and meeting coordination to the conversation and lead.', href: '/platform', tone: 'blue' },
  { icon: BarChart3, title: 'Analytics & Reports', body: 'Understand engagement, campaign activity and AI usage across your workspace.', href: '/platform', tone: 'violet' },
];

const threads = [
  { name: 'Ayesha Khan', channel: 'WhatsApp', time: '2m', preview: 'I want to know about your December packages.', message: 'Absolutely. I can help you explore the available packages. Are you planning for a group or an individual booking?', initials: 'AK', color: 'mint', tag: 'New enquiry' },
  { name: 'Imran Patel', channel: 'Email', time: '8m', preview: 'Can we schedule a product walkthrough?', message: 'Of course. I can help coordinate a walkthrough. Which day usually works best for your team?', initials: 'IP', color: 'blue', tag: 'Demo interest' },
  { name: 'Sara Merchant', channel: 'Website', time: '14m', preview: 'Please share more details about the service.', message: 'Thanks for reaching out. I can share the relevant details and connect you with the right person.', initials: 'SM', color: 'peach', tag: 'Needs reply' },
];

const details: Record<string, { eyebrow: string; title: string; accent: string; body: string; bullets: string[]; icon: LucideIcon; cards: Array<{ title: string; body: string; icon: LucideIcon }> }> = {
  '/platform': {
    eyebrow: 'THE AM AAVIGO PLATFORM',
    title: 'Your customer journey, connected from first touch to next step.',
    accent: 'Connected operations',
    body: 'Amaavigo brings conversations, lead management, AI assistance, campaigns and scheduling into one workspace—so your team can act with the full context.',
    bullets: ['One workspace for customer conversations', 'Connected lead records and activity history', 'AI assistance with configurable human oversight', 'Campaign, follow-up and scheduling workflows'],
    icon: Layers,
    cards: [
      { title: 'Capture', body: 'Bring enquiries into a shared workspace.', icon: Globe },
      { title: 'Understand', body: 'Keep the conversation and lead context together.', icon: Search },
      { title: 'Engage', body: 'Use AI and team workflows to respond.', icon: Bot },
      { title: 'Move forward', body: 'Coordinate follow-ups and scheduling.', icon: CalendarDays },
    ],
  },
  '/unified-inbox': {
    eyebrow: 'UNIFIED INBOX',
    title: 'Every conversation. One clear view.',
    accent: 'Context stays connected',
    body: 'Give your team a shared place to manage supported messaging channels, review AI drafts, take over conversations and see the customer context alongside the thread.',
    bullets: ['WhatsApp, email, website and supported social conversations', 'Conversation views, filters and team workflow', 'Human handoff with clear ownership context', 'Lead profile and activity alongside the message thread'],
    icon: MessageSquare,
    cards: [
      { title: 'One conversation stream', body: 'See the interaction history without jumping between tools.', icon: MessageCircle },
      { title: 'AI and human together', body: 'Keep automated assistance and human ownership visible.', icon: Bot },
      { title: 'Customer context', body: 'See the lead profile while you respond.', icon: Users },
      { title: 'Operational clarity', body: 'Prioritise unread, active and handoff conversations.', icon: Activity },
    ],
  },
  '/ai-agents': {
    eyebrow: 'AI AGENTS & AUTOMATION',
    title: 'Make every response more intentional.',
    accent: 'AI with human control',
    body: 'Use AI assistance across customer conversations and follow-up workflows, with operating modes and handoff controls that keep your team in charge.',
    bullets: ['AI-assisted responses grounded in your configured knowledge', 'Automatic, review and off operating modes', 'Human handoff when a conversation needs your team', 'Follow-up and scheduling workflows connected to leads'],
    icon: Bot,
    cards: [
      { title: 'Understand', body: 'Use conversation context and configured business knowledge.', icon: Search },
      { title: 'Respond', body: 'Generate helpful drafts or automated replies.', icon: MessageSquare },
      { title: 'Escalate', body: 'Bring a human into the conversation when required.', icon: Users },
      { title: 'Continue', body: 'Coordinate the next follow-up or meeting.', icon: CalendarCheck },
    ],
  },
  '/crm': {
    eyebrow: 'CRM & LEAD MANAGEMENT',
    title: 'A clearer pipeline, with the conversation attached.',
    accent: 'From lead to opportunity',
    body: 'Organise contacts, manage lead stages, assign ownership and keep recent customer activity close to the records your team works on every day.',
    bullets: ['Lead and contact records in a shared workspace', 'Pipeline stages, lead status and ownership', 'Lead database organisation for campaign workflows', 'Conversation and follow-up context alongside the lead'],
    icon: Users,
    cards: [
      { title: 'Organise', body: 'Keep contact and lead records structured.', icon: Database },
      { title: 'Prioritise', body: 'Understand stage, status and activity.', icon: BarChart3 },
      { title: 'Coordinate', body: 'Keep the right owner connected to the lead.', icon: Users },
      { title: 'Follow through', body: 'Move the opportunity to its next action.', icon: ArrowRight },
    ],
  },
  '/campaigns': {
    eyebrow: 'CAMPAIGNS & ENGAGEMENT',
    title: 'Make every campaign part of the customer journey.',
    accent: 'Engagement that stays connected',
    body: 'Manage outreach, email design, lead audiences and follow-up activity while keeping campaign engagement connected to the wider workspace.',
    bullets: ['Campaign audience and database workflows', 'Email design studio and reusable templates', 'Campaign reporting and engagement visibility', 'Follow-up workflows connected to lead activity'],
    icon: Send,
    cards: [
      { title: 'Build', body: 'Prepare branded email experiences.', icon: Mail },
      { title: 'Target', body: 'Work with organised lead databases.', icon: Database },
      { title: 'Engage', body: 'Coordinate campaign and follow-up activity.', icon: Send },
      { title: 'Measure', body: 'Review campaign performance and outcomes.', icon: BarChart3 },
    ],
  },
  '/integrations': {
    eyebrow: 'INTEGRATIONS',
    title: 'Bring your existing channels into one operating rhythm.',
    accent: 'Connected tools',
    body: 'Connect the channels and services your team already relies on, then work from a shared view of customer engagement and lead activity.',
    bullets: ['WhatsApp Business and supported Meta channels', 'Email inbox and sending connections', 'Google and Microsoft calendar connections where configured', 'Website forms, webhooks and chatbot integrations'],
    icon: Workflow,
    cards: [
      { title: 'Messaging', body: 'Connect supported WhatsApp and social channels.', icon: MessageCircle },
      { title: 'Email', body: 'Bring email conversations and campaigns into view.', icon: Mail },
      { title: 'Calendar', body: 'Coordinate meetings with connected calendar providers.', icon: CalendarDays },
      { title: 'Website', body: 'Connect forms and website enquiry workflows.', icon: Globe },
    ],
  },
};

const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className, delay = 0 }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 28, filter: 'blur(5px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: reduceMotion ? 0 : 0.78, delay: reduceMotion ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => (
  <span className={light ? 'site-eyebrow site-eyebrow-light' : 'site-eyebrow'}><span className="site-eyebrow-dot" />{children}</span>
);

const PrimaryLink: React.FC<{ href: string; children: React.ReactNode; external?: boolean }> = ({ href, children, external = false }) => (
  <a className="site-button site-button-primary" href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
    {children}<ArrowUpRight size={16} />
  </a>
);

const SecondaryLink: React.FC<{ href: string; children: React.ReactNode; external?: boolean }> = ({ href, children, external = false }) => (
  <a className="site-button site-button-secondary" href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
    {children}<ArrowRight size={16} />
  </a>
);

const SiteHeader: React.FC<{ activePath: string }> = ({ activePath }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-brand" href="/" aria-label="Amaavigo home">
          <img src="/amaavigo-logo.png" alt="Amaavigo" />
          <span className="site-brand-divider" />
          <span className="site-brand-caption">AI growth workspace</span>
        </a>
        <nav className="site-desktop-nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div className={'site-nav-group' + (activePath === group.href ? ' is-current' : '')} key={group.label}>
              <a href={group.href} className="site-nav-trigger">{group.label}<ChevronDown size={13} /></a>
              <div className="site-mega-menu">
                {group.links.map((link) => (
                  <a href={link.href} className="site-mega-link" key={link.href}>
                    <span className="site-mega-icon"><ArrowUpRight size={15} /></span>
                    <span><strong>{link.label}</strong><small>{link.note}</small></span>
                  </a>
                ))}
              </div>
            </div>
          ))}
          <a className={activePath === '/pricing' ? 'site-nav-simple is-active' : 'site-nav-simple'} href="/pricing">Pricing</a>
          <a className={activePath === '/about' ? 'site-nav-simple is-active' : 'site-nav-simple'} href="/about">About</a>
        </nav>
        <div className="site-header-actions">
          <a href="/login" className="site-login-link">Log in</a>
          <a href={DEMO_URL} target="_blank" rel="noreferrer" className="site-button site-button-primary site-button-nav">Book a demo<ArrowUpRight size={15} /></a>
        </div>
        <button className="site-mobile-toggle" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)}>
          {mobileOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      <AnimatePresence>
        {mobileOpen && (
          <motion.nav className="site-mobile-menu" aria-label="Mobile navigation" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: EASE }}>
            <a href="/platform" onClick={() => setMobileOpen(false)}>Platform</a>
            <a href="/unified-inbox" onClick={() => setMobileOpen(false)}>Unified Inbox</a>
            <a href="/ai-agents" onClick={() => setMobileOpen(false)}>AI Agents</a>
            <a href="/crm" onClick={() => setMobileOpen(false)}>CRM & Lead Management</a>
            <a href="/campaigns" onClick={() => setMobileOpen(false)}>Campaigns</a>
            <a href="/solutions" onClick={() => setMobileOpen(false)}>Solutions</a>
            <a href="/integrations" onClick={() => setMobileOpen(false)}>Integrations</a>
            <a href="/pricing" onClick={() => setMobileOpen(false)}>Pricing</a>
            <a href="/resources" onClick={() => setMobileOpen(false)}>Resources</a>
            <a href="/about" onClick={() => setMobileOpen(false)}>About</a>
            <a href="/login" onClick={() => setMobileOpen(false)}>Log in</a>
            <a href={DEMO_URL} target="_blank" rel="noreferrer" onClick={() => setMobileOpen(false)} className="site-mobile-demo">Book a demo <ArrowUpRight size={15} /></a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
};

const SiteFooter: React.FC = () => (
  <footer className="site-footer">
    <div className="site-footer-top">
      <div className="site-footer-brand">
        <a href="/" className="site-brand site-brand-footer"><img src="/amaavigo-logo.png" alt="Amaavigo" /></a>
        <p>One connected workspace for customer conversations, lead operations and intelligent engagement.</p>
      </div>
      <div className="site-footer-col"><strong>Platform</strong><a href="/platform">Overview</a><a href="/unified-inbox">Unified Inbox</a><a href="/ai-agents">AI Agents</a><a href="/crm">CRM & Leads</a><a href="/campaigns">Campaigns</a></div>
      <div className="site-footer-col"><strong>Explore</strong><a href="/solutions">Solutions</a><a href="/integrations">Integrations</a><a href="/pricing">Pricing & plans</a><a href="/resources">Resources</a><a href="/about">About Amaavigo</a></div>
      <div className="site-footer-col"><strong>Account</strong><a href="/login">Log in</a><a href={DEMO_URL} target="_blank" rel="noreferrer">Book a demo</a><a href="/contact">Contact</a></div>
      <div className="site-footer-col"><strong>Legal</strong><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a><a href="/dpa">Data processing agreement</a><a href="/aup">Acceptable use & AI policy</a></div>
    </div>
    <div className="site-footer-bottom"><span>© {new Date().getFullYear()} Amaavigo Digital Solutions LLP. All rights reserved.</span><span>Built for clarity. Designed for momentum.</span></div>
  </footer>
);

const HeroDashboard: React.FC = () => {
  const [activeThread, setActiveThread] = useState(0);
  const selected = threads[activeThread];
  return (
    <div className="hero-product-stage">
      <div className="hero-product-glow" />
      <motion.div className="hero-orbit-ring hero-orbit-ring-one" animate={{ rotate: 360 }} transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}>
        <span className="hero-orbit-point point-one" /><span className="hero-orbit-point point-two" />
      </motion.div>
      <motion.div className="hero-orbit-ring hero-orbit-ring-two" animate={{ rotate: -360 }} transition={{ duration: 46, repeat: Infinity, ease: 'linear' }}>
        <span className="hero-orbit-point point-three" />
      </motion.div>
      <motion.div className="hero-product-window" initial={{ opacity: 0, y: 34, rotateY: -9, rotateX: 4 }} animate={{ opacity: 1, y: 0, rotateY: -4, rotateX: 1 }} transition={{ duration: 1.1, delay: 0.15, ease: EASE }} whileHover={{ rotateY: 0, rotateX: 0, y: -5 }}>
        <div className="hero-window-top">
          <div className="hero-window-dots"><i /><i /><i /></div>
          <span className="hero-window-url"><LockKeyhole size={10} /> app.amaavigo.com</span>
          <span className="hero-live"><i /> Workspace live</span>
          <div className="hero-window-avatar">A</div>
        </div>
        <div className="hero-window-body">
          <aside className="hero-app-sidebar">
            <div className="hero-app-logo">A<span>maavigo</span></div>
            <div className="hero-app-nav active"><Layers size={13} /> Dashboard</div>
            <div className="hero-app-nav"><MessageSquare size={13} /> Unified Inbox <b>12</b></div>
            <div className="hero-app-nav"><Users size={13} /> CRM</div>
            <div className="hero-app-nav"><Send size={13} /> Campaigns</div>
            <div className="hero-app-nav"><Bot size={13} /> AI Agents</div>
            <div className="hero-app-nav"><CalendarDays size={13} /> Scheduling</div>
            <div className="hero-app-nav"><BarChart3 size={13} /> Reports</div>
            <div className="hero-app-nav"><Building2 size={13} /> Workspace</div>
          </aside>
          <div className="hero-app-main">
            <div className="hero-app-toolbar"><span>Unified Inbox</span><div><Search size={12} /> Search conversations</div><Bell size={13} /></div>
            <div className="hero-app-tabs"><span className="selected">All conversations <b>24</b></span><span>WhatsApp</span><span>Email</span><span>Website</span></div>
            <div className="hero-app-content">
              <div className="hero-thread-list">
                {threads.map((thread, index) => (
                  <button key={thread.name} type="button" className={activeThread === index ? 'hero-thread-item selected' : 'hero-thread-item'} onClick={() => setActiveThread(index)}>
                    <span className={'hero-thread-avatar ' + thread.color}>{thread.initials}</span>
                    <span className="hero-thread-copy"><strong>{thread.name}</strong><small>{thread.preview}</small></span>
                    <span className="hero-thread-time">{thread.time}</span>
                  </button>
                ))}
              </div>
              <div className="hero-thread-detail">
                <div className="hero-thread-person"><span className={'hero-thread-avatar ' + selected.color}>{selected.initials}</span><span><strong>{selected.name}</strong><small>{selected.channel} · {selected.tag}</small></span><span className="hero-thread-presence"><i /> Active</span></div>
                <div className="hero-message incoming">Hi, I would like to know more about your services.</div>
                <AnimatePresence mode="wait">
                  <motion.div key={activeThread} className="hero-message ai" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.32 }}>
                    <span className="hero-ai-label"><Sparkles size={10} /> AI reply draft</span>
                    {selected.message}
                  </motion.div>
                </AnimatePresence>
                <div className="hero-thread-composer"><span>Write a reply…</span><button type="button" aria-label="Send preview"><ArrowRight size={13} /></button></div>
              </div>
              <div className="hero-app-profile"><span className="hero-profile-overline">LEAD PROFILE</span><div className="hero-profile-person"><span className="hero-profile-avatar">AK</span><strong>{selected.name}</strong><small>New opportunity</small></div><div className="hero-profile-data"><small>Lead source</small><strong>Website enquiry</strong></div><div className="hero-profile-data"><small>Lead status</small><strong className="hero-profile-status">Engaged</strong></div><div className="hero-profile-data"><small>Next action</small><strong>Follow up</strong></div><div className="hero-profile-action"><CalendarCheck size={12} /> Schedule meeting</div></div>
            </div>
          </div>
        </div>
      </motion.div>
      <motion.div className="hero-float-chip hero-float-chip-top" animate={{ y: [0, -9, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}><span><Sparkles size={13} /></span><div><strong>AI assistance</strong><small>Context-aware drafts</small></div></motion.div>
      <motion.div className="hero-float-chip hero-float-chip-bottom" animate={{ y: [0, 8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}><span><CheckCircle2 size={14} /></span><div><strong>Human handoff</strong><small>Your team stays in control</small></div></motion.div>
    </div>
  );
};

const FeatureTile: React.FC<{ feature: FeatureCard; index: number }> = ({ feature, index }) => {
  const Icon = feature.icon;
  return (
    <Reveal delay={index * 0.055}>
      <a className="site-feature-tile" href={feature.href}>
        <span className={'site-feature-icon tone-' + (feature.tone || 'blue')}><Icon size={21} /></span>
        <span className="site-feature-content"><strong>{feature.title}</strong><small>{feature.body}</small></span>
        <span className="site-feature-arrow"><ArrowUpRight size={16} /></span>
      </a>
    </Reveal>
  );
};

const OrbitSystem: React.FC = () => (
  <div className="orbit-system" aria-label="Illustration of connected platform capabilities">
    <div className="orbit-system-grid" />
    <motion.div className="orbit-track orbit-track-one" animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }} />
    <motion.div className="orbit-track orbit-track-two" animate={{ rotate: -360 }} transition={{ duration: 54, repeat: Infinity, ease: 'linear' }} />
    <div className="orbit-core"><span className="orbit-core-mark">A</span><strong>amaavigo</strong><small>CONNECTED WORKSPACE</small></div>
    <motion.div className="orbit-node orbit-node-inbox" animate={{ y: [0, -8, 0] }} transition={{ duration: 4.5, repeat: Infinity }}><MessageSquare size={18} /><span>Unified Inbox</span></motion.div>
    <motion.div className="orbit-node orbit-node-ai" animate={{ y: [0, 9, 0] }} transition={{ duration: 5.2, repeat: Infinity }}><Bot size={18} /><span>AI Agents</span></motion.div>
    <motion.div className="orbit-node orbit-node-crm" animate={{ y: [0, -7, 0] }} transition={{ duration: 4.8, repeat: Infinity }}><Users size={18} /><span>CRM</span></motion.div>
    <motion.div className="orbit-node orbit-node-campaigns" animate={{ y: [0, 8, 0] }} transition={{ duration: 5.4, repeat: Infinity }}><Send size={18} /><span>Campaigns</span></motion.div>
    <motion.div className="orbit-node orbit-node-data" animate={{ y: [0, -6, 0] }} transition={{ duration: 4.2, repeat: Infinity }}><Database size={18} /><span>Lead data</span></motion.div>
  </div>
);

const WorkflowVisual: React.FC = () => {
  const steps = [
    { icon: Globe, title: 'New enquiry', text: 'A customer reaches out', cls: 'workflow-blue' },
    { icon: Bot, title: 'AI understands', text: 'Context and intent come together', cls: 'workflow-violet' },
    { icon: Users, title: 'Team engages', text: 'A person takes over when needed', cls: 'workflow-orange' },
    { icon: CalendarCheck, title: 'Next step', text: 'Follow-up or meeting is coordinated', cls: 'workflow-green' },
  ];
  return (
    <div className="workflow-visual">
      <div className="workflow-topline"><span><i /> WORKFLOW PREVIEW</span><span>CONNECTED JOURNEY</span></div>
      <div className="workflow-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <React.Fragment key={step.title}>
              <motion.div className={'workflow-step ' + step.cls} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: index * 0.16 }}>
                <span className="workflow-step-icon"><Icon size={20} /></span><strong>{step.title}</strong><small>{step.text}</small>
                <span className="workflow-step-number">0{index + 1}</span>
              </motion.div>
              {index < steps.length - 1 && <motion.div className="workflow-connector" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: index * 0.16 + 0.2 }}><ArrowRight size={16} /></motion.div>}
            </React.Fragment>
          );
        })}
      </div>
      <div className="workflow-bottom-note"><Sparkles size={13} /> One shared view of the customer journey—not disconnected tools.</div>
    </div>
  );
};

const HomePage: React.FC = () => (
  <main className="site-home">
    <section className="site-hero">
      <div className="site-hero-grid" />
      <div className="site-hero-aurora site-hero-aurora-one" />
      <div className="site-hero-aurora site-hero-aurora-two" />
      <div className="site-hero-noise" />
      <div className="site-hero-inner">
        <div className="site-hero-copy">
          <Reveal>
            <Eyebrow light>THE INTELLIGENCE LAYER FOR YOUR BUSINESS</Eyebrow>
            <h1>Every conversation is a signal. <span>Turn it into growth.</span></h1>
            <p className="site-hero-description">One intelligent workspace for customer conversations, lead management, AI assistance and the workflows that move your business forward.</p>
            <div className="site-hero-actions"><PrimaryLink href={DEMO_URL} external>Book a product demo</PrimaryLink><SecondaryLink href="/platform">Explore the platform</SecondaryLink></div>
            <div className="site-hero-proof"><span><ShieldCheck size={15} /> Human oversight stays in control</span><i /><span><Zap size={14} /> Connected customer workflows</span></div>
          </Reveal>
        </div>
        <HeroDashboard />
      </div>
      <div className="site-hero-bottom"><span>CAPTURE</span><i /><span>UNDERSTAND</span><i /><span>ENGAGE</span><i /><span>CONVERT</span><div className="site-hero-scroll"><span>SCROLL TO EXPLORE</span><motion.span animate={{ y: [0, 7, 0] }} transition={{ duration: 1.8, repeat: Infinity }}><ChevronDown size={14} /></motion.span></div></div>
    </section>

    <section className="site-channel-strip">
      <div className="site-channel-strip-label">ONE WORKSPACE.<br /><strong>CONNECTED CHANNELS.</strong></div>
      <div className="site-channel-items">
        <span><MessageCircle className="channel-whatsapp" /> WhatsApp</span><span><Mail /> Email</span><span><Instagram /> Instagram</span><span><Globe /> Website</span><span><CalendarDays /> Calendar</span>
      </div>
    </section>

    <section className="site-platform-section">
      <div className="site-section-container site-platform-layout">
        <Reveal className="site-platform-copy">
          <Eyebrow>THE COMPLETE GROWTH WORKSPACE</Eyebrow>
          <h2>All the moving parts of customer engagement. <span>Finally, in sync.</span></h2>
          <p>From the first enquiry to the next follow-up, Amaavigo helps your team work from one connected operating picture.</p>
          <ul className="site-check-list">
            <li><Check size={15} /> Shared conversations and lead context</li>
            <li><Check size={15} /> AI assistance with clear human handoff</li>
            <li><Check size={15} /> Connected CRM, campaigns and scheduling</li>
            <li><Check size={15} /> Workspace-level reporting and usage visibility</li>
          </ul>
          <a className="site-text-link" href="/platform">Explore the platform <ArrowUpRight size={16} /></a>
        </Reveal>
        <Reveal className="site-orbit-wrap" delay={0.1}><OrbitSystem /></Reveal>
      </div>
    </section>

    <section className="site-features-section">
      <div className="site-section-container">
        <Reveal className="site-section-heading">
          <Eyebrow>ONE CONNECTED SYSTEM</Eyebrow>
          <h2>Everything your team needs to <span>keep momentum.</span></h2>
          <p>Specialist tools, designed to work together instead of creating another silo.</p>
        </Reveal>
        <div className="site-feature-grid">{features.map((feature, index) => <FeatureTile key={feature.title} feature={feature} index={index} />)}</div>
      </div>
    </section>

    <section className="site-inbox-feature">
      <div className="site-section-container site-inbox-layout">
        <Reveal className="site-inbox-visual">
          <div className="site-inbox-visual-glow" />
          <div className="site-inbox-mini-window">
            <div className="site-inbox-mini-head"><span className="site-mini-brand">A</span><strong>Unified Inbox</strong><span className="site-mini-status"><i /> AI on</span></div>
            <div className="site-inbox-mini-body">
              <div className="site-mini-sidebar"><span className="active"><MessageSquare size={14} /></span><span><Users size={14} /></span><span><Bot size={14} /></span><span><Send size={14} /></span></div>
              <div className="site-mini-conversations"><div className="site-mini-search"><Search size={11} /> Search conversations</div><div className="site-mini-person active"><i className="mini-avatar a1">AK</i><span><b>Ayesha Khan</b><small>Can you share the package details?</small></span><em>2m</em></div><div className="site-mini-person"><i className="mini-avatar a2">IP</i><span><b>Imran Patel</b><small>Can we arrange a demo?</small></span><em>8m</em></div><div className="site-mini-person"><i className="mini-avatar a3">SM</i><span><b>Sara Merchant</b><small>Please send more information.</small></span><em>14m</em></div></div>
              <div className="site-mini-thread"><div className="site-mini-thread-head"><b>Ayesha Khan</b><small>WhatsApp · New enquiry</small></div><div className="site-mini-bubble incoming">Hi, I want to know more about the available options.</div><div className="site-mini-bubble reply"><small><Sparkles size={10} /> AI draft</small>Thanks for reaching out. I can help you with that. What are you looking for?</div><div className="site-mini-composer">Write a reply… <span><ArrowUpRight size={12} /></span></div></div>
              <div className="site-mini-profile"><small>LEAD PROFILE</small><div className="mini-profile-avatar">AK</div><b>Ayesha Khan</b><span className="mini-lead-pill">Engaged</span><hr /><small>Lead source</small><b>Website</b><small>Next action</small><b>Follow up</b></div>
            </div>
          </div>
          <motion.div className="site-inbox-float site-inbox-float-one" animate={{ y: [0, -9, 0] }} transition={{ duration: 5.5, repeat: Infinity }}><span><MessageCircle size={15} /></span><b>Conversation received</b></motion.div>
          <motion.div className="site-inbox-float site-inbox-float-two" animate={{ y: [0, 8, 0] }} transition={{ duration: 4.5, repeat: Infinity }}><span><CheckCircle2 size={15} /></span><b>Lead context connected</b></motion.div>
        </Reveal>
        <Reveal className="site-inbox-copy">
          <Eyebrow>THE CONVERSATION LAYER</Eyebrow>
          <h2>More context. Less switching. <span>Better conversations.</span></h2>
          <p>Bring supported channels into one inbox, keep customer context close and give your team a clear way to work with AI and take over when needed.</p>
          <div className="site-inbox-points">
            <div><span><MessageSquare size={17} /></span><p><strong>Every channel in view</strong><small>Keep customer interactions organised in one place.</small></p></div>
            <div><span><Bot size={17} /></span><p><strong>AI and people, side by side</strong><small>Review drafts, reply manually or use configured automation.</small></p></div>
            <div><span><Users size={17} /></span><p><strong>Customer context attached</strong><small>See lead details and activity alongside conversations.</small></p></div>
          </div>
          <a className="site-text-link" href="/unified-inbox">Discover the Unified Inbox <ArrowUpRight size={16} /></a>
        </Reveal>
      </div>
    </section>

    <section className="site-automation-section">
      <div className="site-section-container">
        <Reveal className="site-section-heading site-section-heading-dark">
          <Eyebrow light>INTELLIGENCE IN MOTION</Eyebrow>
          <h2>From first enquiry to next action. <span>Without losing the thread.</span></h2>
          <p>Bring AI assistance, human decisions and follow-up workflows into one connected journey.</p>
        </Reveal>
        <Reveal delay={0.12}><WorkflowVisual /></Reveal>
        <div className="site-automation-foot"><span><Sparkles size={15} /> Configurable AI operating modes</span><span><ShieldCheck size={15} /> Human handoff and team control</span><a href="/ai-agents">Explore AI workflows <ArrowUpRight size={15} /></a></div>
      </div>
    </section>

    <section className="site-operations-section">
      <div className="site-section-container">
        <Reveal className="site-section-heading">
          <Eyebrow>CONNECTED OPERATIONS</Eyebrow>
          <h2>One system behind <span>every next step.</span></h2>
          <p>Keep the tools your team uses every day aligned with the customer journey.</p>
        </Reveal>
        <div className="site-operations-grid">
          <Reveal className="site-operation-card site-operation-card-blue">
            <span className="site-operation-index">01 / SALES</span><span className="site-operation-icon"><Users size={23} /></span><h3>Lead records with real context.</h3><p>Track contacts, ownership, stages and recent activity with the conversation close by.</p><a href="/crm">Explore CRM <ArrowUpRight size={15} /></a><div className="operation-deco operation-deco-bars"><i /><i /><i /><i /><i /></div>
          </Reveal>
          <Reveal className="site-operation-card site-operation-card-navy" delay={0.08}>
            <span className="site-operation-index">02 / ENGAGEMENT</span><span className="site-operation-icon"><Send size={23} /></span><h3>Campaigns that stay connected.</h3><p>Organise audiences, create branded emails and review campaign activity.</p><a href="/campaigns">Explore campaigns <ArrowUpRight size={15} /></a><div className="operation-deco operation-deco-orbit"><span /><span /><span /></div>
          </Reveal>
          <Reveal className="site-operation-card site-operation-card-light" delay={0.16}>
            <span className="site-operation-index">03 / OPERATIONS</span><span className="site-operation-icon"><CalendarCheck size={23} /></span><h3>Follow-up with a clear next step.</h3><p>Connect scheduling, automated follow-ups and customer conversations.</p><a href="/platform">Explore workflows <ArrowUpRight size={15} /></a><div className="operation-deco operation-deco-calendar"><CalendarDays size={92} /></div>
          </Reveal>
        </div>
      </div>
    </section>

    <section className="site-solutions-section">
      <div className="site-section-container site-solutions-layout">
        <Reveal className="site-solutions-copy">
          <Eyebrow>BUILT AROUND REAL WORKFLOWS</Eyebrow>
          <h2>Flexible for your business. <span>Focused on the customer.</span></h2>
          <p>Whether your team handles travel enquiries, service requests or a high volume of sales conversations, Amaavigo helps keep the work connected.</p>
          <div className="site-solution-list">
            <a href="/solutions"><span><Building2 size={18} /></span><div><strong>Travel & Umrah operators</strong><small>Coordinate enquiries, package conversations, follow-ups and consultations.</small></div><ArrowUpRight size={16} /></a>
            <a href="/solutions#sales-teams"><span><Users size={18} /></span><div><strong>Sales and growth teams</strong><small>Manage lead activity and customer conversations with shared context.</small></div><ArrowUpRight size={16} /></a>
            <a href="/solutions#service-businesses"><span><Workflow size={18} /></span><div><strong>Service businesses</strong><small>Organise incoming requests and coordinate team responses.</small></div><ArrowUpRight size={16} /></a>
          </div>
        </Reveal>
        <Reveal className="site-solutions-visual" delay={0.1}>
          <div className="solutions-visual-orbit" />
          <div className="solutions-center"><span>A</span><strong>One customer journey</strong><small>Connected across the team</small></div>
          <div className="solutions-bubble solutions-bubble-top"><MessageSquare size={16} /><span>Enquiry received</span></div>
          <div className="solutions-bubble solutions-bubble-right"><Bot size={16} /><span>AI assistance</span></div>
          <div className="solutions-bubble solutions-bubble-bottom"><CalendarCheck size={16} /><span>Next step scheduled</span></div>
          <div className="solutions-bubble solutions-bubble-left"><Users size={16} /><span>Team follow-up</span></div>
          <motion.div className="solutions-signal" animate={{ rotate: 360 }} transition={{ duration: 22, repeat: Infinity, ease: 'linear' }} />
        </Reveal>
      </div>
    </section>

    <section className="site-integrations-section">
      <div className="site-section-container">
        <div className="site-integrations-layout">
          <Reveal><Eyebrow>YOUR TOOLS, CONNECTED</Eyebrow><h2>Work with the channels your customers <span>already use.</span></h2><p>Connect the right services for your workspace and bring the resulting activity into one place.</p><a className="site-text-link" href="/integrations">Explore integrations <ArrowUpRight size={16} /></a></Reveal>
          <Reveal className="site-integration-orb" delay={0.12}>
            <div className="integration-orbit-ring" /><div className="integration-orbit-ring ring-two" />
            <div className="integration-core">A</div>
            <span className="integration-chip chip-wa"><MessageCircle size={18} /><small>WhatsApp</small></span>
            <span className="integration-chip chip-email"><Mail size={18} /><small>Email</small></span>
            <span className="integration-chip chip-social"><Instagram size={18} /><small>Social</small></span>
            <span className="integration-chip chip-calendar"><CalendarDays size={18} /><small>Calendar</small></span>
            <span className="integration-chip chip-web"><Globe size={18} /><small>Website</small></span>
          </Reveal>
        </div>
      </div>
    </section>

    <PricingTeaser />
    <FinalCta />
  </main>
);

const PricingTeaser: React.FC = () => (
  <section className="site-pricing-teaser">
    <div className="site-section-container site-pricing-teaser-inner">
      <Reveal><Eyebrow light>PLANS THAT FIT YOUR OPERATIONS</Eyebrow><h2>Scale your workspace. <span>Not your complexity.</span></h2><p>Choose the capabilities, seats and usage allowances that match the way your team works.</p><a href="/pricing" className="site-button site-button-primary">Explore pricing & plans <ArrowUpRight size={16} /></a></Reveal>
      <Reveal className="pricing-orbit-card" delay={0.1}>
        <div className="pricing-orbit-large" /><div className="pricing-orbit-small" />
        <div className="pricing-floating-card card-foundation"><span>01</span><strong>Foundation</strong><small>Core lead operations</small></div>
        <div className="pricing-floating-card card-growth"><span>02</span><strong>Growth</strong><small>Connected engagement</small></div>
        <div className="pricing-floating-card card-scale"><span>03</span><strong>Scale</strong><small>Advanced operations</small></div>
        <div className="pricing-floating-card card-enterprise"><span>04</span><strong>Enterprise</strong><small>Configured to your needs</small></div>
      </Reveal>
    </div>
  </section>
);

const FinalCta: React.FC = () => (
  <section className="site-final-cta">
    <div className="site-final-cta-glow" />
    <Reveal className="site-final-cta-inner">
      <Eyebrow light>READY WHEN YOU ARE</Eyebrow>
      <h2>Make every customer conversation count.</h2>
      <p>See how one connected workspace can bring your team, channels and workflows together.</p>
      <div className="site-final-actions"><PrimaryLink href={DEMO_URL} external>Book a product demo</PrimaryLink><a href="/login" className="site-final-login">Already have an account? Log in <ArrowUpRight size={14} /></a></div>
    </Reveal>
    <div className="site-final-stars"><i /><i /><i /><i /><i /><i /><i /><i /></div>
  </section>
);

const PageHero: React.FC<{ eyebrow: string; title: string; body: string; icon: LucideIcon; dark?: boolean }> = ({ eyebrow, title, body, icon: Icon, dark = true }) => (
  <section className={dark ? 'site-subhero site-subhero-dark' : 'site-subhero site-subhero-light'}>
    {dark && <><div className="site-hero-grid" /><div className="site-hero-aurora site-hero-aurora-one" /><div className="site-subhero-orb" /></>}
    <div className="site-section-container site-subhero-inner">
      <Reveal>
        <Eyebrow light={dark}>{eyebrow}</Eyebrow>
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="site-subhero-actions"><PrimaryLink href={DEMO_URL} external>Talk to our team</PrimaryLink><SecondaryLink href="/pricing">Explore plans</SecondaryLink></div>
      </Reveal>
      <Reveal className="site-subhero-visual" delay={0.1}>
        <div className="site-subhero-visual-ring ring-a" /><div className="site-subhero-visual-ring ring-b" />
        <div className="site-subhero-visual-core"><Icon size={34} /><span>AMAAVIGO</span><small>CONNECTED WORKSPACE</small></div>
        <div className="site-subhero-visual-chip chip-a"><Sparkles size={15} /> Intelligence</div>
        <div className="site-subhero-visual-chip chip-b"><CheckCircle2 size={15} /> Context connected</div>
      </Reveal>
    </div>
  </section>
);

const DetailPage: React.FC<{ path: string }> = ({ path }) => {
  const page = details[path] || details['/platform'];
  const Icon = page.icon;
  return (
    <main className="site-detail-page">
      <PageHero eyebrow={page.eyebrow} title={page.title} body={page.body} icon={Icon} />
      <section className="site-detail-band">
        <div className="site-section-container site-detail-band-layout">
          <Reveal><Eyebrow>DESIGNED TO WORK TOGETHER</Eyebrow><h2>{page.accent}<span> — with the context your team needs.</span></h2><p>Keep people, conversations and operational actions connected in one consistent experience.</p></Reveal>
          <Reveal className="site-detail-bullets" delay={0.1}>{page.bullets.map((bullet) => <div key={bullet}><span><Check size={15} /></span>{bullet}</div>)}</Reveal>
        </div>
      </section>
      <section className="site-detail-cards">
        <div className="site-section-container">
          <Reveal className="site-section-heading"><Eyebrow>HOW IT COMES TOGETHER</Eyebrow><h2>Built around the work <span>your team actually does.</span></h2></Reveal>
          <div className="site-detail-card-grid">
            {page.cards.map((card, index) => {
              const CardIcon = card.icon;
              return <Reveal key={card.title} delay={index * 0.07}><article className="site-detail-card"><span><CardIcon size={21} /></span><small>0{index + 1}</small><h3>{card.title}</h3><p>{card.body}</p></article></Reveal>;
            })}
          </div>
        </div>
      </section>
      <section className="site-detail-product"><div className="site-section-container site-detail-product-layout"><div><Eyebrow light>ONE CONNECTED WORKSPACE</Eyebrow><h2>Less fragmentation. <span>More forward motion.</span></h2><p>Explore how this capability works alongside the rest of Amaavigo—from the first customer touchpoint to the next action.</p><PrimaryLink href="/platform">Explore the platform</PrimaryLink></div><div className="site-detail-product-graphic"><OrbitSystem /></div></div></section>
      <FinalCta />
    </main>
  );
};

const PricingPage: React.FC = () => {
  const options = [
    { number: '01', name: 'Foundation', descriptor: 'For teams building a connected lead process.', list: ['Lead and contact organisation', 'Shared customer conversation workflows', 'Core team operations', 'Workspace reporting'] },
    { number: '02', name: 'Growth', descriptor: 'For teams bringing AI into everyday engagement.', list: ['Everything in your core workspace', 'AI-assisted conversations and follow-ups', 'Campaign and engagement workflows', 'Connected scheduling'] },
    { number: '03', name: 'Scale', descriptor: 'For teams coordinating more complex operations.', list: ['Advanced workflow configuration', 'Team roles and operational controls', 'Expanded reporting and usage visibility', 'Connected business processes'] },
    { number: '04', name: 'Enterprise', descriptor: 'For organisations with tailored requirements.', list: ['Workspace configuration for your operations', 'Custom integration discussions', 'Usage and access planning', 'Dedicated onboarding discussion'] },
  ];
  return (
    <main className="site-pricing-page">
      <PageHero eyebrow="PRICING & PLANS" title="A plan that fits the way your team works." body="Build the right mix of workspace capabilities, team access and usage allowances for your business. No one-size-fits-all assumptions." icon={Layers} />
      <section className="site-pricing-options">
        <div className="site-section-container">
          <Reveal className="site-section-heading"><Eyebrow>CHOOSE YOUR OPERATING STAGE</Eyebrow><h2>Start with what you need. <span>Scale with clarity.</span></h2><p>These are planning pathways, not fixed product entitlements. Your final plan and limits are confirmed in your proposal.</p></Reveal>
          <div className="site-plan-grid">
            {options.map((option, index) => (
              <Reveal key={option.name} delay={index * 0.07}>
                <article className={index === 1 ? 'site-plan-card site-plan-card-featured' : 'site-plan-card'}>
                  <div className="site-plan-top"><span>{option.number} / AMAAVIGO</span>{index === 1 && <b>POPULAR PATH</b>}</div>
                  <h3>{option.name}</h3><p>{option.descriptor}</p>
                  <div className="site-plan-price">Tailored <small>to your workspace</small></div>
                  <ul>{option.list.map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul>
                  <a href={DEMO_URL} target="_blank" rel="noreferrer" className={index === 1 ? 'site-plan-action is-primary' : 'site-plan-action'}>Discuss this plan <ArrowUpRight size={15} /></a>
                </article>
              </Reveal>
            ))}
          </div>
          <div className="site-pricing-note"><ShieldCheck size={17} /><p><strong>Transparent usage matters.</strong> Final subscription amounts and allowances depend on the configured plan, seats and usage. AI model usage is measured from actual requests and applicable model rates. WhatsApp provider charges are separate from the platform subscription.</p></div>
        </div>
      </section>
      <section className="site-pricing-factors"><div className="site-section-container"><Reveal className="site-section-heading"><Eyebrow>WHAT SHAPES YOUR PLAN</Eyebrow><h2>Built around your <span>actual usage.</span></h2></Reveal><div className="site-factor-grid">{[{icon:Users,title:'Team access',body:'Workspace seats, roles and team structure.'},{icon:Layers,title:'Capabilities',body:'The modules and workflows your team needs.'},{icon:Zap,title:'AI usage',body:'Actual AI requests, tokens and model pricing.'},{icon:Send,title:'Engagement volume',body:'Messaging and campaign usage across providers.'}].map((factor,index)=>{const Icon=factor.icon;return <Reveal key={factor.title} delay={index*.06}><div className="site-factor"><span><Icon size={20}/></span><strong>{factor.title}</strong><small>{factor.body}</small></div></Reveal>;})}</div></div></section>
      <FinalCta />
    </main>
  );
};

const SolutionsPage: React.FC = () => (
  <main className="site-solutions-page">
    <PageHero eyebrow="SOLUTIONS" title="A connected way to manage customer-led work." body="Bring lead capture, customer conversations, AI assistance and team follow-through into a shared operating rhythm." icon={Workflow} />
    <section className="site-solution-detail-section">
      <div className="site-section-container">
        <Reveal className="site-section-heading"><Eyebrow>WORKFLOWS, NOT JUST FEATURES</Eyebrow><h2>Designed for teams that live on <span>customer conversations.</span></h2></Reveal>
        <div className="site-solution-detail-grid">
          <article className="site-solution-detail-card" id="travel-operators"><div className="solution-detail-icon"><Globe size={24}/></div><span>01 / TRAVEL & UMRAH</span><h3>Travel and Umrah operators</h3><p>Bring package enquiries, customer conversations, lead qualification, consultation scheduling and sales follow-up into one workspace.</p><ul><li><Check size={14}/>Centralise incoming enquiries</li><li><Check size={14}/>Keep customer context with the lead</li><li><Check size={14}/>Coordinate follow-up and consultation</li></ul><a href="/platform">Explore the platform <ArrowUpRight size={15}/></a></article>
          <article className="site-solution-detail-card" id="sales-teams"><div className="solution-detail-icon"><Users size={24}/></div><span>02 / SALES TEAMS</span><h3>Sales and growth teams</h3><p>Keep pipeline activity, conversations, team ownership and campaign engagement connected as opportunities move forward.</p><ul><li><Check size={14}/>Organise leads and ownership</li><li><Check size={14}/>Review conversations in context</li><li><Check size={14}/>Coordinate the next sales action</li></ul><a href="/crm">Explore CRM <ArrowUpRight size={15}/></a></article>
          <article className="site-solution-detail-card" id="service-businesses"><div className="solution-detail-icon"><Building2 size={24}/></div><span>03 / SERVICE OPERATIONS</span><h3>Service businesses</h3><p>Give teams a consistent place to manage customer requests, coordinate responses and preserve interaction history.</p><ul><li><Check size={14}/>Share customer context</li><li><Check size={14}/>Bring AI into response workflows</li><li><Check size={14}/>Maintain follow-up visibility</li></ul><a href="/unified-inbox">Explore Unified Inbox <ArrowUpRight size={15}/></a></article>
        </div>
      </div>
    </section>
    <FinalCta />
  </main>
);

const IntegrationsPage: React.FC = () => (
  <main className="site-integrations-page">
    <PageHero eyebrow="INTEGRATIONS" title="Your channels and tools, working as one." body="Connect supported messaging, email, calendar and website services to the customer workflows your team manages in Amaavigo." icon={Workflow} />
    <section className="site-integrations-catalog"><div className="site-section-container"><Reveal className="site-section-heading"><Eyebrow>CONNECT YOUR ECOSYSTEM</Eyebrow><h2>Bring the right tools <span>into the same context.</span></h2><p>Availability depends on provider access, workspace configuration and the features enabled for your account.</p></Reveal>
      <div className="site-integration-grid">
        {[{icon:MessageCircle,name:'WhatsApp Business',kind:'Messaging',desc:'Manage supported WhatsApp conversations from the Unified Inbox.'},{icon:Mail,name:'Email',kind:'Messaging',desc:'Connect mailboxes and email sending for customer engagement.'},{icon:Instagram,name:'Instagram',kind:'Social',desc:'Bring supported Instagram conversations into your workspace.'},{icon:Globe,name:'Website',kind:'Lead capture',desc:'Connect website enquiries, forms and chatbot workflows.'},{icon:CalendarDays,name:'Google Calendar',kind:'Scheduling',desc:'Coordinate meeting availability and demo bookings.'},{icon:CalendarCheck,name:'Microsoft Calendar',kind:'Scheduling',desc:'Connect Microsoft calendar workflows where configured.'},{icon:Workflow,name:'Webhooks',kind:'Automation',desc:'Connect external systems through supported webhook workflows.'},{icon:Database,name:'Workspace data',kind:'Operations',desc:'Keep lead and campaign data organised across modules.'}].map((item,index)=>{const Icon=item.icon;return <Reveal key={item.name} delay={index*.045}><article className="site-integration-card"><span className="site-integration-icon"><Icon size={22}/></span><small>{item.kind}</small><strong>{item.name}</strong><p>{item.desc}</p><span className="site-integration-indicator"><i/> Provider connection</span></article></Reveal>;})}
      </div>
    </div></section>
    <FinalCta />
  </main>
);

const ResourcesPage: React.FC = () => (
  <main className="site-resources-page">
    <PageHero eyebrow="RESOURCES" title="Ideas and practical workflows for better engagement." body="Explore how the pieces of a connected lead and customer engagement process fit together." icon={Layers} dark={false}/>
    <section className="site-resources-grid"><div className="site-section-container"><div className="site-resource-cards">
      <a href="/resources#how-it-works" className="site-resource-card" id="how-it-works"><span><Workflow size={22}/></span><small>WORKFLOW GUIDE</small><h3>From enquiry to next action</h3><p>Understand how capture, context, response and follow-up can work together.</p><ArrowUpRight size={17}/></a>
      <a href="/unified-inbox" className="site-resource-card"><span><MessageSquare size={22}/></span><small>PRODUCT GUIDE</small><h3>Working from one inbox</h3><p>Explore channel views, AI drafts, human handoff and lead context.</p><ArrowUpRight size={17}/></a>
      <a href="/ai-agents" className="site-resource-card"><span><Bot size={22}/></span><small>AI GUIDE</small><h3>AI with human oversight</h3><p>Learn about operating modes, handoff and response workflows.</p><ArrowUpRight size={17}/></a>
      <a href="/crm" className="site-resource-card"><span><Users size={22}/></span><small>OPERATIONS GUIDE</small><h3>Keep leads moving</h3><p>Connect pipeline stages, lead ownership and customer activity.</p><ArrowUpRight size={17}/></a>
    </div></div></section>
    <section className="site-faq-section" id="faqs"><div className="site-section-container"><Reveal className="site-section-heading"><Eyebrow>COMMON QUESTIONS</Eyebrow><h2>Good questions. <span>Clear answers.</span></h2></Reveal>
      <div className="site-faq-list">
        <details><summary>What is Amaavigo? <ChevronDown size={17}/></summary><p>Amaavigo is a connected lead and customer engagement workspace combining supported conversations, CRM, AI assistance, campaigns and operational workflows.</p></details>
        <details><summary>Can my team review AI replies before they are sent? <ChevronDown size={17}/></summary><p>The platform includes configurable operating modes, including a review workflow where generated drafts can be checked by a human before dispatch.</p></details>
        <details><summary>Can I connect my existing WhatsApp Business number? <ChevronDown size={17}/></summary><p>WhatsApp onboarding depends on provider eligibility and the supported connection flow. The setup process will show whether the number can be connected.</p></details>
        <details><summary>How is AI usage accounted for? <ChevronDown size={17}/></summary><p>Workspace usage tracks AI requests and tokens, with estimated cost calculated using the applicable model pricing available to the platform.</p></details>
        <details><summary>Are WhatsApp provider charges included in the platform subscription? <ChevronDown size={17}/></summary><p>WhatsApp provider charges are separate from the Amaavigo platform subscription and depend on the provider's current pricing and usage.</p></details>
      </div>
    </div></section>
    <FinalCta />
  </main>
);

const AboutPage: React.FC = () => (
  <main className="site-about-page">
    <PageHero eyebrow="ABOUT AMAAVIGO" title="We build connected experiences for the work behind growth." body="Amaavigo Digital Solutions LLP brings product thinking, automation and customer-focused workflows together to help businesses operate with more clarity." icon={Sparkles} />
    <section className="site-about-story"><div className="site-section-container site-about-story-layout"><Reveal><Eyebrow>OUR PRODUCT BELIEF</Eyebrow><h2>Technology should connect the work, <span>not add another layer.</span></h2></Reveal><Reveal className="site-about-story-copy" delay={0.12}><p>Customer engagement rarely happens in one place. Enquiries arrive through different channels, teams manage leads in separate tools and follow-ups can lose context.</p><p>Amaavigo is designed to bring those workflows closer together—so people, conversations and next actions stay connected.</p><a className="site-text-link" href="/platform">Explore the platform <ArrowUpRight size={15}/></a></Reveal></div></section>
    <section className="site-about-values"><div className="site-section-container"><div className="site-about-value-grid">{[{icon:Layers,title:'Connected by design',body:'Bring customer context and operational work into a shared view.'},{icon:ShieldCheck,title:'Human in control',body:'Use automation with visibility, permission and clear handoff.'},{icon:Zap,title:'Built for momentum',body:'Reduce the distance between a customer signal and a useful next step.'}].map((item,index)=>{const Icon=item.icon;return <Reveal key={item.title} delay={index*.08}><article><span><Icon size={22}/></span><h3>{item.title}</h3><p>{item.body}</p></article></Reveal>;})}</div></div></section>
    <FinalCta />
  </main>
);

const ContactPage: React.FC = () => (
  <main className="site-contact-page">
    <PageHero eyebrow="CONTACT & PRODUCT DEMO" title="Let's map the right workflow for your team." body="Tell us about the conversations, lead operations and automations you want to bring together. Our team can walk you through the platform and discuss the right setup." icon={MessageCircle} />
    <section className="site-contact-panel"><div className="site-section-container site-contact-layout"><Reveal><Eyebrow>START A CONVERSATION</Eyebrow><h2>See how Amaavigo fits <span>your business.</span></h2><p>Use the official Amaavigo consultation form to share your details and request a product discussion.</p><PrimaryLink href={DEMO_URL} external>Open demo request form</PrimaryLink></Reveal><Reveal className="site-contact-info" delay={0.12}><div><span><CalendarDays size={19}/></span><strong>Product walkthrough</strong><small>Discuss the workflows your team wants to improve.</small></div><div><span><Workflow size={19}/></span><strong>Workspace fit</strong><small>Map channels, CRM, AI and automation capabilities.</small></div><div><span><Layers size={19}/></span><strong>Plan discussion</strong><small>Explore setup, usage and subscription options.</small></div></Reveal></div></section>
  </main>
);

export const LandingPage: React.FC = () => {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/' : '/';
  const pageNames: Record<string, string> = {
    '/': 'AI Lead & Customer Engagement Platform',
    '/platform': 'Platform',
    '/unified-inbox': 'Unified Inbox',
    '/ai-agents': 'AI Agents',
    '/crm': 'CRM & Lead Management',
    '/campaigns': 'Campaigns',
    '/integrations': 'Integrations',
    '/solutions': 'Solutions',
    '/pricing': 'Pricing & Plans',
    '/resources': 'Resources',
    '/about': 'About',
    '/contact': 'Contact',
    '/book-demo': 'Book a Demo',
  };
  const pageName = pageNames[pathname] || pageNames['/'];
  useEffect(() => {
    document.title = pageName + ' | Amaavigo';
    let description = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    description.content = 'Amaavigo connects customer conversations, lead management, AI assistance, campaigns and business workflows in one intelligent workspace.';
  }, [pageName]);

  let page: React.ReactNode;
  if (pathname === '/pricing') page = <PricingPage />;
  else if (pathname === '/solutions') page = <SolutionsPage />;
  else if (pathname === '/integrations') page = <IntegrationsPage />;
  else if (pathname === '/resources') page = <ResourcesPage />;
  else if (pathname === '/about') page = <AboutPage />;
  else if (pathname === '/contact' || pathname === '/book-demo') page = <ContactPage />;
  else if (details[pathname]) page = <DetailPage path={pathname} />;
  else page = <HomePage />;

  return <div className="site-root"><SiteHeader activePath={pathname} />{page}<SiteFooter /></div>;
};

export default LandingPage;
