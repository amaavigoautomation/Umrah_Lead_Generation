import React, { useEffect, useState } from 'react';
import { DEFAULT_LEGAL_DOCS, LEGAL_SLUGS, type LegalContent, type LegalSlug } from '../shared/legalDefaults';
import { LegalMarkdown } from './LegalMarkdown';

export const LEGAL_PATHS: Record<LegalSlug, string> = {
  privacy: '/privacy',
  terms: '/terms',
  dpa: '/dpa',
  aup: '/aup',
};

const NAV_LABEL: Record<LegalSlug, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  dpa: 'Data Processing Agreement',
  aup: 'Acceptable Use & AI Policy',
};

/** Returns the legal slug for a URL path ("/privacy", "/terms/"), or null when the path is not a legal page. */
export function legalSlugFromPath(pathname: string): LegalSlug | null {
  const clean = pathname.replace(/\/+$/, '').toLowerCase();
  return (LEGAL_SLUGS.find((s) => LEGAL_PATHS[s] === clean) as LegalSlug | undefined) || null;
}

/** Public, signed-out page showing the published version of one legal document. */
export const LegalPage: React.FC<{ slug: LegalSlug }> = ({ slug }) => {
  const [doc, setDoc] = useState<(LegalContent & { version?: number; publishedAt?: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    fetch(`/api/legal/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => !cancelled && setDoc(d))
      .catch(() => !cancelled && setDoc(DEFAULT_LEGAL_DOCS[slug]));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (doc?.title) document.title = `${doc.title} | Amaavigo Digital Solutions LLP`;
  }, [doc]);

  const sections = (doc?.sections || []).filter((s) => s.heading || s.body.trim());

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <a href="/" className="text-sm font-semibold text-slate-900">Amaavigo Digital Solutions LLP</a>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {LEGAL_SLUGS.map((s) => (
              <a
                key={s}
                href={LEGAL_PATHS[s]}
                className={s === slug ? 'text-orange-600 font-semibold' : 'text-slate-600 hover:text-slate-900'}
              >
                {NAV_LABEL[s]}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {!doc ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <article className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-10">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{doc.title}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {doc.effectiveDate ? `Effective date: ${doc.effectiveDate}` : 'Effective date: to be confirmed on publication'}
            </p>

            {sections.filter((s) => s.heading).length > 4 && (
              <nav aria-label="Contents" className="mt-6 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm">
                <p className="font-semibold text-slate-900 mb-2">Contents</p>
                <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {sections.filter((s) => s.heading).map((s) => (
                    <li key={s.id}><a href={`#${s.id}`} className="text-slate-600 hover:text-orange-600">{s.heading}</a></li>
                  ))}
                </ol>
              </nav>
            )}

            <div className="mt-8 space-y-8">
              {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-6">
                  {s.heading && <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-3">{s.heading}</h2>}
                  <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
                    <LegalMarkdown text={s.body} />
                  </div>
                </section>
              ))}
            </div>
          </article>
        )}
        <footer className="mt-8 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>Amaavigo Digital Solutions LLP · privacy@amaavigo.com</span>
          <a href="/" className="text-orange-600 hover:underline">Back to sign in</a>
        </footer>
      </main>
    </div>
  );
};
