import OpenAI from 'openai';
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

/** تحويل رسائلنا لصيغة الـ Responses API */
function toInput(req: ResolvedRequest): OpenAI.Responses.ResponseInput {
  return req.messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content } as OpenAI.Responses.ResponseInputItem;
    }

    // الصور مدعومة في رسائل المستخدم فقط
    if (m.role === 'assistant') {
      const text = m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      return { role: 'assistant', content: text } as OpenAI.Responses.ResponseInputItem;
    }

    const content = m.content.map((part) =>
      part.type === 'text'
        ? { type: 'input_text' as const, text: part.text }
        : {
            type: 'input_image' as const,
            image_url: `data:${part.mimeType};base64,${part.data}`,
            detail: 'auto' as const,
          },
    );
    return { role: 'user', content } as OpenAI.Responses.ResponseInputItem;
  });
}

function toUsage(u: OpenAI.Responses.ResponseUsage | undefined | null): TokenUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
    cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? 0,
  };
}

function toFinishReason(r: OpenAI.Responses.Response): FinishReason {
  if (r.status === 'incomplete') {
    return r.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'unknown';
  }
  if (r.status === 'completed') return 'stop';
  if (r.status === 'failed') return 'error';
  return 'unknown';
}

/**
 * بعض الموديلات (زي موديلات الـ reasoning) بترفض بارامتر temperature بالكامل
 * وبترجع 400 لو اتبعت. بنكتشف الحالة دي من رسالة الخطأ عشان نعيد المحاولة من غيره.
 */
function isUnsupportedTemperatureError(err: unknown): boolean {
  const e = err as { message?: string; error?: { message?: string } };
  const message = e?.error?.message ?? e?.message ?? '';
  return /temperature/i.test(message) && /(unsupported parameter|not supported)/i.test(message);
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  private client: OpenAI | null = null;

  isConfigured(): boolean {
    return isRealApiKey(process.env.OPENAI_API_KEY);
  }

  /** الإنشاء متأخر عشان الملف ينفع يتـ import من غير مفتاح موجود */
  private getClient(): OpenAI {
    if (!this.isConfigured()) {
      throw new AIError('unauthorized', {
        provider: 'openai',
        providerMessage: 'OPENAI_API_KEY غير موجود',
      });
    }
    this.client ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // لتوجيه الطلبات لبروكسي داخلي أو سيرفر اختبار
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
      timeout: Number(process.env.AI_TIMEOUT_MS ?? 120_000),
      maxRetries: 2,
    });
    return this.client;
  }

  private baseParams(req: ResolvedRequest) {
    return {
      model: req.entry.providerModel,
      input: toInput(req),
      ...(req.system ? { instructions: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      max_output_tokens: Math.min(
        req.maxOutputTokens ?? req.entry.maxOutputTokens,
        req.entry.maxOutputTokens,
      ),
      // مانخزنش المحادثات عند المزود — البيانات تفضل في Firestore بتاعنا
      store: false,
    };
  }

  async chat(req: ResolvedRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    try {
      const params = { ...this.baseParams(req), stream: false as const };
      let res;
      try {
        res = await this.getClient().responses.create(params, { signal: req.signal });
      } catch (err) {
        // بعض الموديلات (زي موديلات الـ reasoning) بترفض بارامتر temperature —
        // نعيد المحاولة من غيره بدل ما نفشل الطلب بالكامل
        if ('temperature' in params && isUnsupportedTemperatureError(err)) {
          const { temperature: _drop, ...rest } = params;
          res = await this.getClient().responses.create(rest, { signal: req.signal });
        } else {
          throw err;
        }
      }

      const usage = toUsage(res.usage);
      return {
        text: res.output_text ?? '',
        model: req.entry.id,
        provider: this.provider,
        providerModel: req.entry.providerModel,
        usage,
        costUsd: calculateCost(req.entry, usage),
        finishReason: toFinishReason(res),
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      throw normalizeProviderError(err, 'openai');
    }
  }

  async *stream(req: ResolvedRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const startedAt = Date.now();
    let text = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: FinishReason = 'unknown';

    try {
      const params = { ...this.baseParams(req), stream: true as const };
      let stream;
      try {
        stream = await this.getClient().responses.create(params, { signal: req.signal });
      } catch (err) {
        if ('temperature' in params && isUnsupportedTemperatureError(err)) {
          const { temperature: _drop, ...rest } = params;
          stream = await this.getClient().responses.create(rest, { signal: req.signal });
        } else {
          throw err;
        }
      }

      yield { type: 'start', model: req.entry.id, provider: this.provider };

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          text += event.delta;
          yield { type: 'delta', text: event.delta };
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          usage = toUsage(event.response.usage);
          finishReason = toFinishReason(event.response);
        } else if (event.type === 'error') {
          throw new AIError('unknown', { provider: 'openai', providerMessage: event.message });
        }
      }
    } catch (err) {
      throw normalizeProviderError(err, 'openai');
    }

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
