import { KnowledgeDocument } from '../types';

export interface RetrievedChunk {
  documentId: string;
  title: string;
  category: string;
  relevantExcerpt: string;
  score: number;
}

/**
 * Searches published knowledge base using keyword frequency, n-gram matching,
 * and category heuristics to extract top relevant snippets without sending the entire KB.
 */
export function retrieveRelevantKnowledge(
  query: string,
  knowledgeDocs: KnowledgeDocument[],
  maxResults: number = 3
): RetrievedChunk[] {
  // Only query PUBLISHED documents as required by Section 26
  const publishedDocs = knowledgeDocs.filter((doc) => doc.status === 'PUBLISHED');

  if (!query || query.trim() === '') {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const queryTokens = normalizedQuery
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 2);

  // Specific domain intent weightings
  const intentBoosts: Record<string, string[]> = {
    pricing: ['price', 'pricing', 'cost', 'plan', 'plans', 'starter', 'growth', 'enterprise', 'users', 'subscription', 'quote', 'discount'],
    b2b: ['b2b', 'agent', 'agents', 'sub-agent', 'subagent', 'wholesaler', 'reseller', 'markup', 'credit', 'voucher'],
    packages: ['package', 'itinerary', 'fit', 'groups', 'hotel', 'hotels', 'makkah', 'madinah', 'ziyarat', 'transport', 'train', 'bus'],
    visa: ['visa', 'nusuk', 'evisa', 'passport', 'mofa', 'document', 'stamped'],
    invoicing: ['invoice', 'costing', 'vat', 'gst', 'tax', 'forex', 'currency', 'sar', 'ledger'],
    faq: ['setup', 'onboarding', 'security', 'time', 'mobile', 'support', 'contract'],
  };

  const scoredDocs = publishedDocs.map((doc) => {
    let score = 0;
    const docText = `${doc.title} ${doc.category} ${doc.tags.join(' ')} ${doc.content}`.toLowerCase();

    // 1. Direct term match
    queryTokens.forEach((token) => {
      const occurrences = (docText.match(new RegExp(`\\b${token}\\b`, 'g')) || []).length;
      if (occurrences > 0) {
        score += occurrences * 3;
      } else if (docText.includes(token)) {
        score += 1;
      }
    });

    // 2. Intent matching
    for (const [intent, keywords] of Object.entries(intentBoosts)) {
      const queryMatchesIntent = keywords.some((kw) => normalizedQuery.includes(kw));
      const docMatchesIntent = keywords.some((kw) => docText.includes(kw));
      if (queryMatchesIntent && docMatchesIntent) {
        score += 8;
        if (doc.category.toLowerCase().includes(intent)) {
          score += 6;
        }
      }
    }

    // 3. Title match boost
    queryTokens.forEach((token) => {
      if (doc.title.toLowerCase().includes(token)) {
        score += 5;
      }
    });

    // Extract the most relevant paragraph/excerpt
    const paragraphs = doc.content.split('\n\n');
    let bestParagraph = paragraphs[0] || doc.content;
    let bestParaScore = 0;

    paragraphs.forEach((p) => {
      let pScore = 0;
      const lowerP = p.toLowerCase();
      queryTokens.forEach((token) => {
        if (lowerP.includes(token)) pScore += 2;
      });
      if (pScore > bestParaScore) {
        bestParaScore = pScore;
        bestParagraph = p;
      }
    });

    return {
      documentId: doc.id,
      title: doc.title,
      category: doc.category,
      relevantExcerpt: bestParagraph.trim(),
      score,
    };
  });

  return scoredDocs
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
