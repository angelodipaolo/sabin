import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api';

/**
 * Markdown from files and agents, rendered and sanitised. Agent messages are
 * untrusted text: DOMPurify strips anything active, and the page's CSP is the
 * backstop. Links never navigate the app; http(s) ones open in the browser.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'] });
}

export function onMarkdownClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href') ?? '';
  if (/^https?:\/\//.test(href)) void api.openExternal(href);
}

export function Markdown({ text, class: className }: { text: string; class?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div class={`markdown ${className ?? ''}`} onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
