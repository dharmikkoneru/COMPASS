import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Extract text from a PDF file in the browser using pdfjs-dist.
 * The worker runs off the main thread, so large files don't freeze the UI.
 */
export async function extractPdfText(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const data = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data });
  const doc = await task.promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(pageText);
    onProgress?.(i / doc.numPages);
  }
  await task.destroy();

  return pages.join('\n\n').trim();
}

/** Trim material text to a size the AI backend can handle comfortably. */
export function clampText(text: string, maxChars = 60_000): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[truncated]`;
}
