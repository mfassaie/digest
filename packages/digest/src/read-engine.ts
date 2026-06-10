// Local extractive read engine: no LLM, no network, deterministic. Summary
// via lead + frequency-scored sentence selection; keywords via TF over
// content words minus stopwords. Behind an interface so an LLM engine can
// be slotted in later (deferred per ADR-006 follow-up).

export interface ReadEngine {
  summarise(markdown: string, maxSentences: number): string;
  keywords(markdown: string, max: number): string[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'of', 'this',
  'that', 'these', 'those', 'it', 'its', 'as', 'so', 'than', 'too',
  'very', 'can', 'will', 'just', 'not', 'no', 'nor', 'only', 'own',
  'same', 'such', 'each', 'all', 'any', 'both', 'more', 'most', 'other',
  'some', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she',
  'his', 'her', 'i', 'me', 'my', 'us', 'them',
]);

// Strip markdown syntax to plain prose for analysis: drop code fences,
// headings markers, links-to-text, emphasis, list bullets.
function toProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#-]+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(prose: string): string[] {
  return prose
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function termFrequencies(prose: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words(prose)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

export const extractiveEngine: ReadEngine = {
  summarise(markdown, maxSentences) {
    const prose = toProse(markdown);
    const sentences = splitSentences(prose);
    if (sentences.length <= maxSentences) return sentences.join(' ');
    const freq = termFrequencies(prose);
    // Score each sentence by summed term frequency, normalised by length to
    // avoid favouring long sentences; keep a lead bias for the first one.
    const scored = sentences.map((s, idx) => {
      const ws = words(s).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
      const score = ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0)
        / Math.max(1, ws.length);
      return { s, idx, score: idx === 0 ? score + 1 : score };
    });
    const top = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.idx - b.idx) // restore document order
      .map((x) => x.s);
    return top.join(' ');
  },

  keywords(markdown, max) {
    const freq = termFrequencies(toProse(markdown));
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, max)
      .map(([w]) => w);
  },
};
