import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatResult,
  FinishReason,
  ProviderAdapter,
  ResolvedRequest,
  StreamEvent,
  TokenUsage,
} from '../types';
import { calculateCost } from '../models';
import { AIError, normalizeProviderError } from '../errors';
import { isRealApiKey } from '../env';

function toMessages(req: ResolvedRequest): Anthropic.MessageParam[] {
  return req.messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }

    const blocks: Anthropic.ContentBlockParam[] = m.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: part.data,
            },
          },
    );
    return { role: m.role, content: blocks };
  });
}

function toFinishReason(stop: Anthropic.Message['stop_reason']): FinishReason {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return isRealApiKey(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.isConfigured()) {
      throw new AIError('unauthorized', {
        provider: 'anthropic',
        providerMessage: 'ANTHROPIC_API_KEY غير موجود',
      });
    }
    this.client ??= new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
      timeout: Number(process.env.AI_TIMEOUT_MS ?? 120_000),
      maxRetries: 2,
    });
    return this.client;
  }

  private baseParams(req: ResolvedRequest) {
    return {
      model: req.entry.providerModel,
      messages: toMessages(req),
      // Claude بياخد الـ system كوسيط منفصل مش كرسالة داخل المحادثة
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      max_tokens: Math.min(
        req.maxOutputTokens ?? req.entry.maxOutputTokens,
        req.entry.maxOutputTokens,
      ),
    };
  }

  async chat(req: ResolvedRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    try {
      const res = await this.getClient().messages.create(
        { ...this.baseParams(req), stream: false },
        { signal: req.signal },
      );

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const usage: TokenUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
        cachedInputTokens: res.usage.cache_read_input_tokens ?? 0,
      };

      return {
        text,
        model: req.entry.id,
        provider: this.provider,
        providerModel: req.entry.providerModel,
        usage,
        costUsd: calculateCost(req.entry, usage),
        finishReason: toFinishReason(res.stop_reason),
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      throw normalizeProviderError(err, 'anthropic');
    }
  }

  async *stream(req: ResolvedRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const startedAt = Date.now();
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let finishReason: FinishReason = 'unknown';

    try {
      const stream = await this.getClient().messages.create(
        { ...this.baseParams(req), stream: true },
        { signal: req.signal },
      );

      yield { type: 'start', model: req.entry.id, provider: this.provider };

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            // توكنز الإدخال بتوصل في أول حدث
            inputTokens = event.message.usage.input_tokens;
            cachedInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
            break;
          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              text += event.delta.text;
              yield { type: 'delta', text: event.delta.text };
            }
            break;
          case 'message_delta':
            // توكنز الإخراج وسبب التوقف بيوصلوا في آخر حدث
            outputTokens = event.usage.output_tokens;
            finishReason = toFinishReason(event.delta.stop_reason);
            break;
        }
      }
    } catch (err) {
      throw normalizeProviderError(err, 'anthropic');
    }

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens,
    };

    yield {
      type: 'done',
      result: {
        text,
        model: req.entry.id,
        provider: this.provider,
        providerModel: req.entry.providerModel,
        usage,
        costUsd: calculateCost(req.entry, usage),
        finishReason,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
