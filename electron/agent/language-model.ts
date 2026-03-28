import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { LanguageModel } from 'ai';
import type { LLMModelConfig } from './model-catalog.js';

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function isAzureOpenAIHost(hostname: string): boolean {
  const n = hostname.trim().toLowerCase();
  return n === 'openai.azure.com' || n.endsWith('.openai.azure.com');
}

function hasOpenAIV1Path(pathname: string): boolean {
  const p = stripTrailingSlashes(pathname.toLowerCase());
  return p === '/openai/v1' || p.startsWith('/openai/v1/');
}

function normalizeOpenAIBaseUrl(endpoint?: string): string | undefined {
  const trimmed = endpoint?.trim() ? stripTrailingSlashes(endpoint.trim()) : '';
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (hasOpenAIV1Path(parsed.pathname)) return trimmed;
  if (!isAzureOpenAIHost(parsed.hostname)) return trimmed;
  const basePath = stripTrailingSlashes(parsed.pathname);
  parsed.pathname = `${basePath}/openai/v1`;
  return stripTrailingSlashes(parsed.toString());
}

function createTemperatureOmissionFetch(): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('x-skynet-omit-temperature') !== '1') {
      return fetch(input, init);
    }

    headers.delete('x-skynet-omit-temperature');

    if (typeof init?.body !== 'string') {
      return fetch(input, {
        ...init,
        headers,
      });
    }

    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && 'temperature' in parsed) {
        delete parsed.temperature;
      }
      return fetch(input, {
        ...init,
        headers,
        body: JSON.stringify(parsed),
      });
    } catch {
      return fetch(input, {
        ...init,
        headers,
      });
    }
  };
}

function createAwsCredentialProvider(profile?: string) {
  const provider = defaultProvider({
    ...(profile ? { profile } : {}),
  });
  return async () => {
    const creds = await provider();
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    };
  };
}

async function createBedrockModel(modelConfig: LLMModelConfig) {
  const configuredHeaders = { ...(modelConfig.extraHeaders ?? {}) };

  // Region: use config, fall back to env, default to us-east-1 when using a gateway endpoint
  const region = modelConfig.region
    || process.env.AWS_REGION
    || process.env.AWS_DEFAULT_REGION
    || (modelConfig.endpoint ? 'us-east-1' : '');

  // Build a credential provider when Bedrock is using the default AWS chain
  const hasExplicitKeys = Boolean(modelConfig.accessKeyId && modelConfig.secretAccessKey);
  const needsCredentialProvider = !modelConfig.apiKey && !hasExplicitKeys;

  // If an AWS profile is configured, set it in env for the default provider chain
  if (modelConfig.awsProfile) {
    process.env.AWS_PROFILE = modelConfig.awsProfile;
  }

  const credentialProviderFn = needsCredentialProvider
    ? createAwsCredentialProvider(modelConfig.awsProfile)
    : undefined;

  const bedrock = createAmazonBedrock({
    ...(region ? { region } : {}),
    ...(modelConfig.endpoint ? { baseURL: modelConfig.endpoint } : {}),
    ...(modelConfig.apiKey ? { apiKey: modelConfig.apiKey } : {}),
    ...(hasExplicitKeys ? { accessKeyId: modelConfig.accessKeyId! } : {}),
    ...(hasExplicitKeys ? { secretAccessKey: modelConfig.secretAccessKey! } : {}),
    ...(modelConfig.sessionToken ? { sessionToken: modelConfig.sessionToken } : {}),
    ...(credentialProviderFn ? { credentialProvider: credentialProviderFn } : {}),
    ...(Object.keys(configuredHeaders).length > 0 ? { headers: configuredHeaders } : {}),
  });

  return bedrock(modelConfig.modelName);
}

export async function createLanguageModelFromConfig(modelConfig: LLMModelConfig): Promise<LanguageModel> {
  if (modelConfig.provider === 'google') {
    throw new Error('Gemini models are not supported by Legion runtime yet.');
  }

  // console.info(
  //   `[LLM] Creating model: provider=${modelConfig.provider} model=${modelConfig.modelName} baseURL=${modelConfig.endpoint ?? 'default'} useResponsesApi=${modelConfig.useResponsesApi ?? 'default'}`,
  // );

  if (modelConfig.provider === 'anthropic') {
    const anthropic = createAnthropic({
      baseURL: stripTrailingSlashes(modelConfig.endpoint),
      ...(modelConfig.apiKey ? { apiKey: modelConfig.apiKey } : {}),
      ...(modelConfig.extraHeaders ? { headers: modelConfig.extraHeaders } : {}),
      fetch: createTemperatureOmissionFetch(),
    });
    return anthropic(modelConfig.modelName);
  }

  if (modelConfig.provider === 'amazon-bedrock') {
    return await createBedrockModel(modelConfig);
  }

  const normalizedBaseUrl = normalizeOpenAIBaseUrl(modelConfig.endpoint);
  const openai = createOpenAI({
    ...(normalizedBaseUrl ? { baseURL: normalizedBaseUrl } : {}),
    apiKey: modelConfig.apiKey || 'dummy',
    headers: {
      ...(modelConfig.apiVersion ? { 'api-version': modelConfig.apiVersion } : {}),
      ...(modelConfig.extraHeaders ?? {}),
    },
  });

  const modelId = modelConfig.deploymentName || modelConfig.modelName;
  // Default to Chat Completions unless a model explicitly opts into Responses.
  if (modelConfig.useResponsesApi === true) {
    return openai(modelId);
  }
  return openai.chat(modelId);
}
