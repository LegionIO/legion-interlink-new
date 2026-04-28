/**
 * Defensive unwrap for LLM responses that arrive as serialized JSON content blocks.
 *
 * Some models occasionally return content in the Anthropic Messages API format:
 *   [{"type":"text","text":"..."}]
 * as a raw string. This strips that wrapper and returns the plain text content.
 *
 * Safe to call on any string — returns it unchanged if it's not JSON-wrapped.
 *
 * NOTE: The main process has a similar normalizeAssistantText() in
 * electron/agent/app-runtime.ts that handles this at the streaming/parse layer.
 * This renderer-side utility is a safety net for paths that bypass main-process
 * normalization (sub-agent threads, sidechains, rehydrated messages, etc.).
 * If you change the unwrap logic here, check normalizeAssistantText too.
 */
export function unwrapContentString(content: string): string {
  if (!content) return content

  const trimmed = content.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return content

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || parsed.length === 0) return content

    // Only unwrap when EVERY element is an Anthropic-shaped text block with a
    // string `text` or `content` field. Any non-text block, missing string,
    // or non-object element bails to the original input — this prevents a user
    // pasting a JSON sample (or a streamed array containing tool_use/image
    // blocks) from being silently rewritten.
    const isTextBlock = (
      block: unknown
    ): block is { type: 'text'; text?: string; content?: string } => {
      if (typeof block !== 'object' || block === null) return false
      const candidate = block as Record<string, unknown>
      if (candidate.type !== 'text') return false
      return typeof candidate.text === 'string' || typeof candidate.content === 'string'
    }

    if (!parsed.every(isTextBlock)) return content

    const extracted = parsed
      .map((block) => block.text ?? block.content ?? '')
      .filter((part) => part.length > 0)
      .join('\n\n')

    return extracted || content
  } catch {
    return content
  }
}
