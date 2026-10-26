import React from 'react';
import { ArrowRight, Bot, Users, MessageSquare, CalendarCheck, ShieldCheck, Workflow, Mail } from 'lucide-react';

const features = [
  { icon: MessageSquare, title: 'Unified conversations', body: 'Bring customer conversations from supported channels into one workspace so your team can follow up with context.' },
  { icon: Bot, title: 'AI-assisted engagement', body: 'Use AI assistance to help draft responses, qualify enquiries, and support your lead engagement workflow.' },
  { icon: Workflow, title: 'Lead and campaign workflows', body: 'Organize leads, manage outreach campaigns, and monitor follow-up activity from a shared workspace.' },
  { icon: CalendarCheck, title: 'Demo scheduling', body: 'Coordinate product walkthrough requests and keep scheduling conversations connected to the lead.' },
];

export const LandingPage: React.FC = () => (
  <div className="min-h-screen bg-[#fbfaf8] text-slate-900">
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="/" className="flex items-center gap-3" aria-label="Amaavigo home">
          <img src="/amaavigo-logo.png" alt="Amaavigo" className="h-9 w-auto object-contain" />
          <span className="hidden border-l border-slate-200 pl-3 text-sm font-semibold text-slate-700 sm:inline">Lead & Engagement Platform</span>
        </a>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#features" className="hidden font-medium text-slate-600 hover:text-orange-600 sm:inline">Features</a>
          <a href="/privacy" className="hidden font-medium text-slate-600 hover:text-orange-600 sm:inline">Privacy</a>
          <a href="/login" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-orange-600">
            Sign in <ArrowRight size={16} />
          </a>
        </nav>
      </div>
    </header>

    <main>
      <section className="relative isolate overflow-hidden">
        <div className="absolute -right-24 -top-20 -z-10 h-96 w-96 rounded-full bg-orange-200/50 blur-3xl" />
        <div className="absolute -left-24 bottom-0 -z-10 h-80 w-80 rounded-full bg-amber-100/70 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-orange-700">
              <span className="h-2 w-2 rounded-full bg-orange-500" /> AI-assisted lead engagement
            </div>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Turn customer conversations into clearer next steps.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Amaavigo’s Lead & Engagement Platform helps teams organize enquiries, manage outreach, respond with AI assistance, and coordinate follow-ups from one workspace.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="/login" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600">
                Access your workspace <ArrowRight size={17} />
              </a>
              <a href="#features" className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                Explore features
              </a>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
              <ShieldCheck size={17} className="text-emerald-600" />
              Built for teams managing customer enquiries and lead workflows.
            </div>
          </div>

          <div className="relative">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10 sm:p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">Workspace overview</p>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">Lead engagement</h2>
                </div>
                <div className="rounded-xl bg-orange-50 p-3 text-orange-600"><Users size={22} /></div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Lead management</p><p className="mt-2 text-sm font-bold">Organized pipeline</p><div className="mt-4 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 w-3/4 rounded-full bg-orange-400" /></div></div>
                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Team inbox</p><p className="mt-2 text-sm font-bold">Shared context</p><div className="mt-4 flex gap-1"><span className="h-2 w-8 rounded-full bg-emerald-400" /><span className="h-2 w-5 rounded-full bg-amber-300" /><span className="h-2 w-7 rounded-full bg-slate-300" /></div></div>
              </div>
              <div className="mt-3 rounded-2xl border border-slate-100 p-4">
                <div className="flex items-center gap-3"><div className="rounded-xl bg-orange-50 p-2.5 text-orange-600"><Mail size={18} /></div><div className="flex-1"><p className="text-sm font-semibold">Customer enquiry</p><p className="mt-1 text-xs text-slate-500">Review the conversation, respond, and choose the next action.</p></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">Example</span></div>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">Illustrative overview — not live account data</p>
            </div>
            <div className="absolute -bottom-5 -left-4 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:block">
              <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Bot size={20} /></div><div><p className="text-xs font-semibold text-slate-900">AI-assisted workflows</p><p className="mt-1 text-[11px] text-slate-500">Human oversight stays in control</p></div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-slate-200 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Platform capabilities</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">A practical workspace for lead engagement</h2>
            <p className="mt-4 leading-7 text-slate-600">Keep the key parts of your lead engagement process connected, from the first enquiry through follow-up and handoff.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-2xl border border-slate-200 bg-[#fdfcfb] p-6 transition hover:-translate-y-1 hover:border-orange-200 hover:shadow-lg hover:shadow-orange-900/5">
                <div className="inline-flex rounded-xl bg-orange-50 p-3 text-orange-600"><Icon size={22} /></div>
                <h3 className="mt-5 text-base font-bold text-slate-900">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 rounded-3xl bg-slate-950 px-6 py-10 text-white sm:px-10 md:flex-row md:items-center">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold sm:text-3xl">Already have an account?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">Sign in to access your workspace and manage your team's lead engagement activities.</p>
          </div>
          <a href="/login" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600">Sign in to Amaavigo <ArrowRight size={17} /></a>
        </div>
      </section>
    </main>

    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm sm:px-8 md:flex-row md:items-center md:justify-between">
        <div><p className="font-semibold text-slate-900">Amaavigo Digital Solutions LLP</p><p className="mt-1 text-xs text-slate-500">Lead & Engagement Platform</p></div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 text-slate-600">
          <a className="hover:text-orange-600 hover:underline" href="/privacy">Privacy Policy</a>
          <a className="hover:text-orange-600 hover:underline" href="/terms">Terms of Service</a>
          <a className="hover:text-orange-600 hover:underline" href="/dpa">Data Processing Agreement</a>
          <a className="hover:text-orange-600 hover:underline" href="/aup">Acceptable Use & AI Policy</a>
          <a className="hover:text-orange-600 hover:underline" href="/login">Sign in</a>
        </nav>
      </div>
    </footer>
  </div>
);
