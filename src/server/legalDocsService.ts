/**
 * Platform-wide legal documents (Privacy Policy, Terms, DPA, AUP).
 *
 * Global (not per workspace): Firestore `legal_documents/{slug}` holds { published, draft } and
 * `legal_documents/{slug}/versions/{n}` keeps every previously published version.
 * Until a platform admin publishes, the public pages serve the seed text in shared/legalDefaults.
 * Only the Admin SDK touches these docs; Firestore rules deny all client access.
 */
import { db, getDoc, getDocs, setDoc, collection, doc } from './adminFirestore.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import { DEFAULT_LEGAL_DOCS, LEGAL_SLUGS, type LegalContent, type LegalSlug } from '../shared/legalDefaults.js';

export interface PublishedLegal extends LegalContent {
  version: number; // 0 = built-in seed text, never published
  publishedAt?: string;
  publishedBy?: string;
}
export interface DraftLegal extends LegalContent {
  updatedAt: string;
  updatedBy: string;
}
export interface LegalAdminView {
  slug: LegalSlug;
  published: PublishedLegal;
  draft: DraftLegal | null;
}
export interface LegalVersionSummary {
  version: number;
  title: string;
  effectiveDate: string;
  publishedAt?: string;
  publishedBy?: string;
}

export class LegalValidationError extends Error {}

const LIMITS = { title: 200, effectiveDate: 80, sections: 100, heading: 200, body: 60000, id: 64 };

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as string[]).includes(value);
}

const docRef = (slug: LegalSlug) => doc(db, 'legal_documents', slug);
const versionRef = (slug: LegalSlug, n: number) => doc(db, 'legal_documents', slug, 'versions', String(n));

/** Validates and normalises admin input. Everything is plain text/Markdown; the pages never render raw HTML. */
export function normaliseLegalContent(input: any): LegalContent {
  if (!input || typeof input !== 'object') throw new LegalValidationError('Document body is required');
  const title = String(input.title ?? '').trim();
  if (!title) throw new LegalValidationError('Title is required');
  if (title.length > LIMITS.title) throw new LegalValidationError(`Title is too long (max ${LIMITS.title})`);
  const effectiveDate = String(input.effectiveDate ?? '').trim();
  if (effectiveDate.length > LIMITS.effectiveDate) throw new LegalValidationError('Effective date is too long');
  if (!Array.isArray(input.sections)) throw new LegalValidationError('Sections must be a list');
  if (input.sections.length > LIMITS.sections) throw new LegalValidationError(`Too many sections (max ${LIMITS.sections})`);
  const seen = new Set<string>();
  const sections = input.sections.map((raw: any, i: number) => {
    let id = String(raw?.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, LIMITS.id) || `s${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const heading = String(raw?.heading ?? '').trim();
    const body = String(raw?.body ?? '');
    if (heading.length > LIMITS.heading) throw new LegalValidationError(`Section ${i + 1}: heading is too long`);
    if (body.length > LIMITS.body) throw new LegalValidationError(`Section ${i + 1}: text is too long`);
    return { id, heading, body };
  });
  return { title, effectiveDate, sections };
}

const defaultPublished = (slug: LegalSlug): PublishedLegal => ({ ...structuredClone(DEFAULT_LEGAL_DOCS[slug]), version: 0 });

async function readDoc(slug: LegalSlug): Promise<{ published?: PublishedLegal; draft?: DraftLegal }> {
  const snap = await getDoc(docRef(slug));
  return snap.exists() ? ((snap.data() as any) || {}) : {};
}

/** What the public page shows. Never throws: falls back to the seed text. */
export async function getPublicLegal(slug: LegalSlug): Promise<PublishedLegal> {
  try {
    const data = await readDoc(slug);
    if (data.published) return data.published;
  } catch (err) {
    console.warn(`[Legal] Could not read ${slug}; serving built-in text.`, err);
  }
  return defaultPublished(slug);
}

export async function getLegalAdminView(slug: LegalSlug): Promise<LegalAdminView> {
  const data = await readDoc(slug);
  return { slug, published: data.published || defaultPublished(slug), draft: data.draft || null };
}

export async function listLegalAdminViews(): Promise<LegalAdminView[]> {
  return Promise.all(LEGAL_SLUGS.map((s) => getLegalAdminView(s)));
}

export async function saveLegalDraft(slug: LegalSlug, content: any, by: string): Promise<LegalAdminView> {
  const clean = normaliseLegalContent(content);
  const draft: DraftLegal = { ...clean, updatedAt: new Date().toISOString(), updatedBy: by };
  await setDoc(docRef(slug), sanitizeForFirestore({ slug, draft }) as any, { merge: true });
  return getLegalAdminView(slug);
}

export async function discardLegalDraft(slug: LegalSlug): Promise<LegalAdminView> {
  await setDoc(docRef(slug), { slug, draft: null }, { merge: true });
  return getLegalAdminView(slug);
}

/**
 * Publishes the saved draft (or `content` if given). The version being replaced is archived first, so any
 * published version can be restored. Version 0 (seed text) is archived as version 0 on first publish.
 */
export async function publishLegal(slug: LegalSlug, by: string, content?: any): Promise<LegalAdminView> {
  const data = await readDoc(slug);
  const source = content !== undefined ? content : data.draft;
  if (!source) throw new LegalValidationError('There is no draft to publish');
  const clean = normaliseLegalContent(source);
  const current = data.published || defaultPublished(slug);
  await setDoc(versionRef(slug, current.version), sanitizeForFirestore(current) as any);
  const next: PublishedLegal = {
    ...clean,
    version: current.version + 1,
    publishedAt: new Date().toISOString(),
    publishedBy: by,
  };
  await setDoc(docRef(slug), sanitizeForFirestore({ slug, published: next, draft: null }) as any, { merge: true });
  return getLegalAdminView(slug);
}

export async function listLegalVersions(slug: LegalSlug): Promise<LegalVersionSummary[]> {
  const snap = await getDocs(collection(db, 'legal_documents', slug, 'versions'));
  const out = snap.docs.map((d: any) => {
    const v = d.data() as PublishedLegal;
    return { version: v.version, title: v.title, effectiveDate: v.effectiveDate, publishedAt: v.publishedAt, publishedBy: v.publishedBy };
  });
  return out.sort((a, b) => b.version - a.version);
}

/** Loads an archived version into the draft (it is not live until published again). */
export async function restoreLegalVersion(slug: LegalSlug, version: number, by: string): Promise<LegalAdminView> {
  if (!Number.isInteger(version) || version < 0) throw new LegalValidationError('Invalid version');
  const snap = await getDoc(versionRef(slug, version));
  if (!snap.exists()) throw new LegalValidationError('That version does not exist');
  const v = snap.data() as PublishedLegal;
  return saveLegalDraft(slug, { title: v.title, effectiveDate: v.effectiveDate, sections: v.sections }, by);
}
