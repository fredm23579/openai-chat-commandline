import fetch from 'node-fetch';

// ─── Tavily (primary — best for AI-augmented retrieval) ───────────────────────

async function tavilySearch(query, maxResults) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    title:   r.title   || '(no title)',
    url:     r.url,
    snippet: r.content || r.description || '',
    score:   r.score,
  }));
}

// ─── Brave Search (secondary) ─────────────────────────────────────────────────

async function braveSearch(query, maxResults) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));
  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': process.env.BRAVE_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data.web?.results || []).slice(0, maxResults).map(r => ({
    title:   r.title,
    url:     r.url,
    snippet: r.description || '',
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isSearchAvailable() {
  return !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY);
}

/**
 * Run a web search using whichever key is configured.
 * Returns an array of { title, url, snippet } objects.
 * Throws if no search key is available or the request fails.
 */
export async function webSearch(query, maxResults = 5) {
  if (process.env.TAVILY_API_KEY) return tavilySearch(query, maxResults);
  if (process.env.BRAVE_API_KEY)  return braveSearch(query, maxResults);
  throw new Error('No search API key configured. Set TAVILY_API_KEY or BRAVE_API_KEY in .env');
}

/**
 * Format search results as a context block to inject into the prompt.
 * The AI is instructed to cite sources using [1], [2], … notation.
 */
export function buildSearchContext(results) {
  if (!results.length) return '';
  const body = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
    .join('\n\n');
  return (
    '\n\n---\nWeb search results (current information — cite sources in your response ' +
    'using [1], [2], … notation and list them at the end):\n\n' +
    body +
    '\n---'
  );
}
