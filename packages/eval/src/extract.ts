import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface Extracted {
  html: string;
  title?: string;
}

// Readability main-content extraction, used to pair with pure converters
// (turndown, rehype, the Go binary). Returns cleaned article HTML. Falls
// back to the original body HTML if Readability finds nothing.
export function extractMainContent(html: string, url: string): Extracted {
  const { document } = parseHTML(html);
  try {
    // Readability mutates the document; clone-equivalent via re-parse is
    // unnecessary here since each call gets its own parseHTML document.
    const article = new Readability(document as unknown as Document).parse();
    if (article?.content) {
      return { html: article.content, title: article.title ?? undefined };
    }
  } catch {
    // fall through to raw body
  }
  const { document: doc2 } = parseHTML(html);
  const body = doc2.querySelector('body');
  return {
    html: body?.innerHTML ?? html,
    title: doc2.querySelector('title')?.textContent ?? undefined,
  };
}
