import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().default(10).describe('Maximum number of results to return'),
  }),
  execute: async (input) => {
    const { query, maxResults } = input as { query: string; maxResults: number };
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Legion-Interlink/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const html = await resp.text();

      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      const links = [...html.matchAll(resultRegex)];
      const snippets = [...html.matchAll(snippetRegex)];

      for (let i = 0; i < Math.min(links.length, maxResults); i++) {
        const rawUrl = links[i][1];
        const decodedUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').split('&')[0]);
        results.push({
          url: decodedUrl,
          title: links[i][2].replace(/<[^>]+>/g, '').trim(),
          snippet: snippets[i] ? snippets[i][1].replace(/<[^>]+>/g, '').trim() : '',
        });
      }

      return { query, resultCount: results.length, results };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};
