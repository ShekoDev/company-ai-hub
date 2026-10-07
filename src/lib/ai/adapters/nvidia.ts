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

/**
 * NVIDIA NIM بيتكلم Chat Completions API (OpenAI-compatible) —
 * مش الـ Responses API الجديدة اللي بتستخدمها adapters/openai.ts.
 * فبنستخدم نفس الـ SDK بتاع OpenAI بس بـ baseURL مختلف وشكل استدعاء مختلف.
 *
 * ملاحظة مهمة عن الإلغاء (AbortSignal):
 * الـ openai SDK (v7) بيبلع الإلغاء جوه الـ streaming loop من غير ما يرمي استثناء
 * (شوف core/streaming.ts — "if the user calls stream.controller.abort(), exit من غير throw").
 * وفي الطلب العادي، الخطأ اللي بيترمي (APIUserAbortError) اسمه مش "AbortError"،
 * فـ normalizeProviderError مش هيلقطه صح. لذلك بنفحص req.signal?.aborted يدويًا
 * بعد كل استدعاء بدل ما نعتمد على الـ SDK يرمي حاجة واضحة.
 */

function toMessages(req: ResolvedRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (req.system) {
    out.push({ role: 'system', content: req.system });
  }

  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam);
      continue;
    }

    // الصور مدعومة في رسائل المستخدم فقط
    if (m.role === 'assistant') {
      const text = m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      out.push({ role: 'assistant', content: text });
      continue;
    }

    const content = m.content.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : {
            type: 'image_url' as const,
            image_url: { url: `data:${part.mimeType};base64,${part.data}` },
          },
    );
    out.push({ role: 'user', content } as OpenAI.Chat.ChatCompletionMessageParam);
  }

  return out;
}

function toUsage(u: OpenAI.CompletionUsage | undefined | null): TokenUsage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
    cachedInputTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

function toFinishReason(r: string | null | undefined): FinishReason {
  if (r === 'stop') return 'stop';
  if (r === 'length') return 'length';
  if (r === 'content_filter') return 'content_filter';
  return 'unknown';
}

/** بيبني AIError('aborted') موحّد — نفس الرسالة والـ retryable اللي gateway.ts بيتوقعهم */
function abortedError(): AIError {
  return new AIError('aborted', { provider: 'nvidia' });
}

export class NvidiaAdapter implements ProviderAdapter {
  readonly provider = 'nvidia' as const;
  private client: OpenAI | null = null;

  isConfigured(): boolean {
    return isRealApiKey(process.env.NVIDIA_API_KEY);
  }

  /** الإنشاء متأخر عشان الملف ينفع يتـ import من غير مفتاح موجود */
  private getClient(): OpenAI {
    if (!this.isConfigured()) {
      throw new AIError('unauthorized', {
        provider: 'nvidia',
        providerMessage: 'NVIDIA_API_KEY غير موجود',
      });
    }
    this.client ??= new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
      timeout: Number(process.env.AI_TIMEOUT_MS ?? 120_000),
      maxRetries: 2,
    });
    return this.client;
  }

  private baseParams(req: ResolvedRequest) {
    return {
      model: req.entry.providerModel,
      messages: toMessages(req),
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
      const res = await this.getClient().chat.completions.create(
        { ...this.baseParams(req), stream: false },
        { signal: req.signal },
      );

      const choice = res.choices[0];
      const usage = toUsage(res.usage);
      return {
        text: choice?.message?.content ?? '',
        model: req.entry.id,
        provider: this.provider,
        providerModel: req.entry.providerModel,
        usage,
        costUsd: calculateCost(req.entry, usage),
        finishReason: toFinishReason(choice?.finish_reason),
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      // APIUserAbortError اسمه مش "AbortError" فـ normalizeProviderError مش هيلقطه —
      // بنفحص الإشارة نفسها بدل ما نعتمد على اسم الخطأ
      if (req.signal?.aborted) throw abortedError();
      throw normalizeProviderError(err, 'nvidia');
    }
  }

  async *stream(req: ResolvedRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const startedAt = Date.now();
    let text = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: FinishReason = 'unknown';

    try {
      const stream = await this.getClient().chat.completions.create(
        {
          ...this.baseParams(req),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: req.signal },
      );

      yield { type: 'start', model: req.entry.id, provider: this.provider };

      for await (const chunk of stream) {
        if (req.signal?.aborted) break;

        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: 'delta', text: delta };
        }

        const fr = chunk.choices[0]?.finish_reason;
        if (fr) finishReason = toFinishReason(fr);

        if (chunk.usage) usage = toUsage(chunk.usage);
      }
    } catch (err) {
      if (req.signal?.aborted) {
        const e = abortedError();
        yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable };
        return;
      }
      throw normalizeProviderError(err, 'nvidia');
    }

    // الـ SDK بيبلع الإلغاء جوه الـ loop من غير ما يرمي استثناء — لازم نفحص هنا كمان
    if (req.signal?.aborted) {
      const e = abortedError();
      yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable };
      return;
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
