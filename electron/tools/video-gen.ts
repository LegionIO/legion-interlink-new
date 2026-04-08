import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { createMediaGenClient, saveMediaToFile, filePathToUrl, streamToBuffer } from './media-gen-utils.js';
import { recordUsageEvent } from '../ipc/usage.js';

const POLL_INTERVAL_MS = 10000; // 10 seconds, matching visual-mcp

export function createVideoGenTool(getConfig: () => AppConfig, appHome: string): ToolDefinition {
  return {
    name: 'generate_video',
    description:
      'Generate a video from a text prompt using an AI video generation model (e.g. Sora 2). ' +
      'Returns a local file URL that can be embedded as a video element. ' +
      'Video generation can take several minutes. The video is saved to disk automatically.',
    inputSchema: z.object({
      prompt: z.string().describe('A detailed description of the video to generate.'),
      duration_seconds: z.number().optional().describe('Length of the video in seconds (4, 8, or 12). Defaults to 4.'),
      size: z.string().optional().describe('Video resolution, e.g. "720x1280", "1280x720", "1024x1792", "1792x1024". Defaults to "1280x720".'),
    }),
    execute: async (input, context: ToolExecutionContext) => {
      const { prompt, duration_seconds, size } = input as {
        prompt: string;
        duration_seconds?: number;
        size?: string;
      };

      const config = getConfig().videoGeneration;
      if (!config?.enabled) {
        return { error: 'Video generation is not enabled. Enable it in Settings > Media Generation > Video.' };
      }

      try {
        const model = config.model || 'sora-2';
        const deploymentName = config.azure?.deploymentName || model;

        // Create OpenAI client with video deployment header
        const client = createMediaGenClient(config, {
          'x-ms-oai-video-generation-deployment': deploymentName,
        });

        // Submit video generation job
        const videoSize = size || config.size || '1280x720';
        const seconds = `${duration_seconds ?? 4}` as '4' | '8' | '12';

        context.onProgress?.({
          stream: 'stdout',
          delta: `Submitting video generation request...\nModel: ${model}\nSize: ${videoSize}\nDuration: ${seconds}s\n`,
          output: `Submitting video generation request...\nModel: ${model}\nSize: ${videoSize}\nDuration: ${seconds}s\n`,
          bytesSeen: 0,
          truncated: false,
          stopped: false,
        });

        const createResponse = await client.videos.create({
          model,
          prompt,
          seconds,
          size: videoSize as '720x1280' | '1280x720' | '1024x1792' | '1792x1024',
        });

        const jobId = createResponse.id;

        context.onProgress?.({
          stream: 'stdout',
          delta: `Video job submitted: ${jobId}\nPolling for completion...\n`,
          output: `Video job submitted: ${jobId}\nPolling for completion...\n`,
          bytesSeen: 0,
          truncated: false,
          stopped: false,
        });

        // Poll for completion
        let videoStatus = await client.videos.retrieve(jobId);
        let pollCount = 0;

        while (!['succeeded', 'failed', 'completed', 'cancelled'].includes(videoStatus.status)) {
          // Check for abort
          if (context.abortSignal?.aborted) {
            return { error: 'Video generation was cancelled.', jobId };
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          pollCount++;

          videoStatus = await client.videos.retrieve(jobId);

          context.onProgress?.({
            stream: 'stdout',
            delta: `Status: ${videoStatus.status} (poll #${pollCount}, ${pollCount * POLL_INTERVAL_MS / 1000}s elapsed)\n`,
            output: `Job ID: ${jobId}\nStatus: ${videoStatus.status}\nPoll #${pollCount} (${pollCount * POLL_INTERVAL_MS / 1000}s elapsed)\n`,
            bytesSeen: 0,
            truncated: false,
            stopped: false,
          });
        }

        if (['failed', 'cancelled'].includes(videoStatus.status)) {
          return {
            error: `Video generation ${videoStatus.status}`,
            jobId,
          };
        }

        // Download the video content
        context.onProgress?.({
          stream: 'stdout',
          delta: 'Downloading video content...\n',
          output: 'Downloading video content...\n',
          bytesSeen: 0,
          truncated: false,
          stopped: false,
        });

        const videoResponse = await client.videos.downloadContent(videoStatus.id);
        if (!videoResponse.ok || !videoResponse.body) {
          return { error: 'Failed to download video content.', jobId };
        }

        const videoBuffer = await streamToBuffer(videoResponse.body);
        const filePath = saveMediaToFile(videoBuffer, 'videos', 'mp4', appHome);
        const fileUrl = filePathToUrl(filePath);

        recordUsageEvent({
          modality: 'video-gen',
          videoCount: 1,
          size: videoSize,
          modelKey: model,
        });

        return {
          type: 'video_generation_result',
          filePath,
          url: fileUrl,
          markdownPreview: `<video src="${fileUrl}" controls>Your browser does not support the video tag.</video>`,
          prompt,
          model,
          jobId,
          durationSeconds: duration_seconds ?? 4,
          size: videoSize,
        };
      } catch (err) {
        return {
          error: `Video generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
