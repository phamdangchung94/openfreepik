import { buildAiPrompt } from "@/app/docs/api/ai-prompt";

/**
 * GET /api/v1/llms.txt
 *
 * Anthropic / Claude / many AI tools auto-discover `/llms.txt` at the
 * domain root or under common path prefixes. Serving the same prompt
 * blob the docs page generates means AI agents that fetch this URL
 * directly get the full integration brief without needing the human
 * to copy-paste.
 *
 * Convention: https://llmstxt.org. Markdown body, public, cached.
 */
export function GET() {
  const body = buildAiPrompt();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=600, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
