/**
 * Search Backend — SearXNG wrapper + result hashing.
 *
 * This is the ONLY component that decrypts and executes search queries.
 * - Receives encrypted query blobs from relay network
 * - Decrypts using backend's private key
 * - Executes search via SearXNG or Brave Search API
 * - Hashes results for onchain integrity proof
 * - Zero logs by design
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { EncryptedQueryBlob, SearchResponse, SearchResultItem, HexString } from '@meshsearch/types';
import { decryptQueryAtBackend, hashResults } from '@meshsearch/crypto';

const app = new Hono();

const PORT = parseInt(process.env.PORT || '4001', 10);
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || 'dev-backend-private-key';
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Search endpoint — receives encrypted query from relay network
app.post('/search', async (c) => {
  const startTime = Date.now();

  const body = await c.req.json<{ encryptedQuery: EncryptedQueryBlob }>();

  if (!body.encryptedQuery) {
    return c.json({ error: 'Missing encryptedQuery' }, 400);
  }

  // 1. Decrypt the query
  let query: string;
  try {
    query = await decryptQueryAtBackend(body.encryptedQuery, BACKEND_PRIVATE_KEY);
  } catch {
    return c.json({ error: 'Decryption failed' }, 400);
  }

  // 2. Execute search
  let results: SearchResultItem[];
  try {
    results = await executeSearch(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed';
    return c.json({ error: message }, 502);
  }

  // 3. Hash results for integrity proof
  const resultsJson = JSON.stringify(results);
  const resultHash = hashResults(resultsJson);

  const response: SearchResponse = {
    results,
    resultHash,
    totalResults: results.length,
    searchTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
  };

  // Zero logs: we don't store the query or the results
  return c.json(response);
});

/**
 * Execute a search query via SearXNG (primary) or Brave Search API (fallback)
 */
async function executeSearch(query: string): Promise<SearchResultItem[]> {
  // Try SearXNG first
  try {
    return await searchSearXNG(query);
  } catch {
    // Fallback to Brave Search API if configured
    if (BRAVE_API_KEY) {
      return await searchBrave(query);
    }
    throw new Error('No search backend available');
  }
}

/**
 * Search via self-hosted SearXNG instance
 */
async function searchSearXNG(query: string): Promise<SearchResultItem[]> {
  const url = new URL('/search', SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', 'general');

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status}`);
  }

  const data = await response.json() as {
    results: Array<{
      title: string;
      url: string;
      content: string;
      engine: string;
      score: number;
    }>;
  };

  return data.results.slice(0, 20).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    source: r.engine,
    score: r.score || 0.5,
  }));
}

/**
 * Search via Brave Search API (fallback)
 */
async function searchBrave(query: string): Promise<SearchResultItem[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '20');

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search error: ${response.status}`);
  }

  const data = await response.json() as {
    web?: {
      results: Array<{
        title: string;
        url: string;
        description: string;
      }>;
    };
  };

  return (data.web?.results ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: 'brave',
    score: 1 - i * 0.05,
  }));
}

// Export for testing
export { app, executeSearch };

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Search backend running on port ${PORT}`);
});
