import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpenAI } from 'openai';

export type MediaGenProviderConfig = {
  enabled?: boolean;
  provider?: 'openai' | 'azure' | 'custom';
  openai?: { apiKey?: string };
  azure?: { endpoint?: string; apiKey?: string; deploymentName?: string; apiVersion?: string };
  custom?: { baseUrl?: string; apiKey?: string };
  model?: string;
};

export type ResolvedEndpoint = {
  url: string;
  headers: Record<string, string>;
};

/**
 * Create an OpenAI SDK client configured for the given media generation provider.
 * Used by video generation (which needs the SDK for videos.create/retrieve/downloadContent).
 *
 * Azure note: The Sora/video API lives at {endpoint}/openai/v1/videos (NOT the
 * per-deployment path used by DALL-E image generation). The SDK appends "/videos"
 * to baseURL, so we set baseURL = "{endpoint}/openai/v1".
 * Azure also authenticates via the "api-key" header, not "Authorization: Bearer".
 */
export function createMediaGenClient(
  config: MediaGenProviderConfig,
  deploymentHeaders?: Record<string, string>,
): OpenAI {
  const provider = config.provider ?? 'azure';

  if (provider === 'openai') {
    const apiKey = config.openai?.apiKey;
    if (!apiKey) throw new Error('OpenAI API key is not configured for media generation.');
    return new OpenAI({ apiKey });
  }

  if (provider === 'azure') {
    const azureCfg = config.azure;
    let endpoint = azureCfg?.endpoint?.replace(/\/+$/, '');
    if (!endpoint) throw new Error('Azure endpoint is not configured for media generation.');

    // Normalise the endpoint: Azure video/Sora API lives under cognitiveservices.azure.com.
    // If the user configured the .openai.azure.com variant, swap the hostname so the SDK
    // hits the correct service.
    endpoint = endpoint.replace('.openai.azure.com', '.cognitiveservices.azure.com');

    // The OpenAI SDK appends resource paths like "/videos" to baseURL.
    // Azure expects the full path to be "{endpoint}/openai/v1/videos", so set
    // baseURL to "{endpoint}/openai/v1".
    const baseURL = `${endpoint}/openai/v1`;

    return new OpenAI({
      apiKey: azureCfg?.apiKey || 'dummy-key',
      baseURL,
      defaultHeaders: {
        ...(azureCfg?.apiKey ? { 'api-key': azureCfg.apiKey } : {}),
        ...deploymentHeaders,
      },
    });
  }

  if (provider === 'custom') {
    const customCfg = config.custom;
    const baseUrl = customCfg?.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Custom base URL is not configured for media generation.');

    return new OpenAI({
      apiKey: customCfg?.apiKey || 'dummy-key',
      baseURL: baseUrl,
      defaultHeaders: deploymentHeaders,
    });
  }

  throw new Error(`Unknown media generation provider: ${provider}`);
}

/**
 * Resolve the API endpoint and auth headers based on provider config.
 * Used by image and audio generation (which use direct fetch for simpler control).
 *
 * @param config - The media generation provider config section
 * @param path - The API path to append (e.g. '/images/generations')
 * @param azureStyle - Azure URL style to use:
 *   - 'deployment' (default): per-deployment URL used by DALL-E image generation
 *       → {endpoint}/openai/deployments/{deployment}{path}?api-version=...
 *   - 'v1': newer /openai/v1 pattern used by audio and other recent APIs
 *       → {endpoint}/openai/v1{path}  (hostname swapped to cognitiveservices.azure.com)
 */
export function resolveMediaGenEndpoint(
  config: MediaGenProviderConfig,
  path: string,
  azureStyle: 'deployment' | 'v1' = 'deployment',
): ResolvedEndpoint {
  const provider = config.provider ?? 'azure';

  if (provider === 'openai') {
    const apiKey = config.openai?.apiKey;
    if (!apiKey) throw new Error('OpenAI API key is not configured for media generation.');
    return {
      url: `https://api.openai.com/v1${path}`,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };
  }

  if (provider === 'azure') {
    const azureCfg = config.azure;
    let endpoint = azureCfg?.endpoint?.replace(/\/+$/, '');
    if (!endpoint) throw new Error('Azure endpoint is not configured for media generation.');

    if (azureStyle === 'v1') {
      // Newer Azure APIs (audio, etc.) live on cognitiveservices.azure.com at /openai/v1/...
      endpoint = endpoint.replace('.openai.azure.com', '.cognitiveservices.azure.com');
      const url = `${endpoint}/openai/v1${path}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(azureCfg?.apiKey ? { 'api-key': azureCfg.apiKey } : {}),
      };
      return { url, headers };
    }

    // 'deployment' style: per-deployment URL used by DALL-E image generation
    const deploymentName = azureCfg?.deploymentName || config.model;
    const apiVersion = azureCfg?.apiVersion || '2024-02-01';

    if (!deploymentName) throw new Error('Azure deployment name is not configured for media generation.');

    const url = `${endpoint}/openai/deployments/${deploymentName}${path}?api-version=${apiVersion}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${azureCfg?.apiKey ?? ''}`,
    };

    return { url, headers };
  }

  if (provider === 'custom') {
    const customCfg = config.custom;
    const baseUrl = customCfg?.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Custom base URL is not configured for media generation.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (customCfg?.apiKey) {
      headers['Authorization'] = `Bearer ${customCfg.apiKey}`;
    }

    return {
      url: `${baseUrl}${path}`,
      headers,
    };
  }

  throw new Error(`Unknown media generation provider: ${provider}`);
}

/**
 * Save generated media data to disk.
 *
 * @param data - The media data as a Buffer
 * @param type - Subdirectory: 'images', 'videos', or 'audio'
 * @param ext - File extension (e.g. 'png', 'mp4', 'mp3')
 * @param legionHome - The Legion home directory (e.g. ~/.legionio)
 * @returns The absolute file path of the saved file
 */
export function saveMediaToFile(
  data: Buffer,
  type: 'images' | 'videos' | 'audio',
  ext: string,
  legionHome: string,
): string {
  const dir = join(legionHome, 'media', type);
  mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const uuid = randomUUID().slice(0, 8);
  const filename = `${timestamp}-${uuid}.${ext}`;
  const filePath = join(dir, filename);

  writeFileSync(filePath, data);
  return filePath;
}

/**
 * Convert a media file path to a legion-media:// URL for the Electron renderer.
 * The path must be under ~/.legionio/media/ (e.g. ~/.legionio/media/images/file.png).
 * Returns a URL like legion-media://images/file.png
 */
export function filePathToUrl(filePath: string): string {
  // Extract the relative path after /media/ to form the protocol URL
  const mediaMarker = '/media/';
  const idx = filePath.indexOf(mediaMarker);
  if (idx !== -1) {
    const relativePath = filePath.slice(idx + mediaMarker.length);
    return `legion-media://${relativePath}`;
  }
  // Fallback: use the full path (shouldn't happen in practice)
  return `legion-media://${filePath}`;
}

/**
 * Read a ReadableStream into a Buffer.
 */
export async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
