/**
 * Defensive unwrap for LLM responses that arrive as serialized JSON content blocks.
 *
 * Some models occasionally return content in the Anthropic Messages API format:
 *   [{"type":"text","text":"..."}]
 * as a raw string. This strips that wrapper and returns the plain text content.
 *
 * Safe to call on any string — returns it unchanged if it's not JSON-wrapped.
 */
export function unwrapContentString(content: string): string {
  if (!content) return content

  const trimmed = content.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return content

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return content

    const textBlocks = parsed.filter(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        (block as Record<string, unknown>).type === 'text'
    )

    if (textBlocks.length === 0) return content

    const extracted = textBlocks
      .map((block: Record<string, unknown>) => {
        return (block.text as string) || (block.content as string) || ''
      })
      .filter(Boolean)
      .join('\n')

    return extracted || content
  } catch {
    return content
  }
}
