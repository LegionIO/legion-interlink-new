import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import type { ToolDefinition } from './types.js';
import { withBrandUserAgent } from '../utils/user-agent.js';

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the text content of the page with HTML tags stripped for readability.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch'),
    maxLength: z.number().optional().default(50000).describe('Maximum content length to return'),
  }),
  execute: async (input) => {
    const { url, maxLength } = input as { url: string; maxLength: number };
    try {
      const resp = await fetch(url, {
        headers: withBrandUserAgent(),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return { error: `HTTP ${resp.status} ${resp.statusText}` };
      const contentType = resp.headers.get('content-type') ?? '';
      let content = await resp.text();

      if (contentType.includes('text/html')) {
        content = sanitizeHtml(content, {
          allowedTags: [],
          allowedAttributes: {},
        })
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + '\n\n[Truncated]';
      }

      return { url, contentType, length: content.length, content };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};
