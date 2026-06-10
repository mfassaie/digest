// Shared converter contract for the eval. The winning adapter's logic is
// promoted into container/src/converter.ts in Phase B.

export interface ConvertResult {
  markdown: string;
  title?: string;
}

export interface Converter {
  name: string;
  // True if the converter does its own main-content extraction
  // (strips nav/ads). Pure converters pair with extract.ts.
  extracts: boolean;
  // Short note on the pipeline, shown in RESULTS.md.
  note: string;
  convert(html: string, url: string): Promise<ConvertResult>;
}
