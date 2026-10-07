import { GoogleGenAI, type Content, type Part, type GenerateContentResponse } from '@google/genai';
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

function toContents(req: ResolvedRequest): Content[] {
  return req.messages.map((m) => {
    // Gemini بيسمي دور المساعد "model" مش "assistant"
    const role = m.role === 'assistant' ? 'model' : 'user';

    if (typeof m.content === 'string') {
      return { role, parts: [{ text: m.content }] };
    }

    const parts: Part[] = m.content.map((part) =>
      part.type === 'text'
        ? { text: part.text }
        : { inlineData: { mimeType: part.mimeType, data: part.data } },
    );
    return { role, parts };
  });
}

function toUsage(res: GenerateContentResponse): TokenUsage {
  const u = res.usageMetadata;
  const inputTokens = u?.promptTokenCount ?? 0;
  // أهم فرق عن باقي المزودين: توكنز التفكير بتتحسب إخراج ومبتظهرش في candidatesTokenCount
  const outputTokens = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: u?.totalTokenCount ?? inputTokens + outputTokens,
    cachedInputTokens: u?.cachedContentTokenCount ?? 0,
  };
}

function toFinishReason(res: GenerateContentResponse): FinishReason {
  const reason = res.candidates?.[0]?.finishReason;
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
    case 'IMAGE_SAFETY':
      return 'content_filter';
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Gemini ممكن يرفض الطلب كله قبل ما يولّد أي حاجة */
function assertNotBlocked(res: GenerateContentResponse) {
  const blockReason = res.promptFeedback?.blockReason;
  if (blockReason) {
    throw new AIError('content_filter', {
      provider: 'gemini',
      providerMessage: `تم حظر الطلب: ${blockReason}`,
    });
  }
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini' as const;
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return isRealApiKey(process.env.GEMINI_API_KEY) || isRealApiKey(process.env.GOOGLE_API_KEY);
  }

  private getClient(): GoogleGenAI {
    if (!this.isConfigured()) {
      throw new AIError('unauthorized', {
        provider: 'gemini',
        providerMessage: 'GEMINI_API_KEY غير موجود',
      });
    }
    this.client ??= new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      ...(process.env.GEMINI_BASE_URL
        ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } }
        : {}),
    });
    return this.client;
  }

  private baseParams(req: ResolvedRequest) {
    return {
      model: req.entry.providerModel,
      contents: toContents(req),
      config: {
        ...(req.system ? { systemInstruction: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        maxOutputTokens: Math.min(
          req.maxOutputTokens ?? req.entry.maxOutputTokens,
          req.entry.maxOutputTokens,
        ),
        ...(req.signal ? { abortSignal: req.signal } : {}),
      },
    };
  }

  async chat(req: ResolvedRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    try {
      const res = await this.getClient().models.generateContent(this.baseParams(req));
      assertNotBlocked(res);

      const usage = toUsage(res);
      return {
        text: res.text ?? '',
        model: req.entry.id,
        provider: this.provider,
        providerModel: req.entry.providerModel,
        usage,
        costUsd: calculateCost(req.entry, usage),
        finishReason: toFinishReason(res),
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      throw normalizeProviderError(err, 'gemini');
    }
  }

  async *stream(req: ResolvedRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const startedAt = Date.now();
    let text = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: FinishReason = 'unknown';

    try {
      const stream = await this.getClient().models.generateContentStream(this.baseParams(req));

      yield { type: 'start', model: req.entry.id, provider: this.provider };

      for await (const chunk of stream) {
        assertNotBlocked(chunk);

        const delta = chunk.text;
        if (delta) {
          text += delta;
          yield { type: 'delta', text: delta };
        }

        // Gemini بيبعت usageMetadata متراكمة مع كل chunk — الأخيرة هي النهائية
        if (chunk.usageMetadata) usage = toUsage(chunk);
        const reason = toFinishReason(chunk);
        if (reason !== 'unknown') finishReason = reason;
      }
    } catch (err) {
      throw normalizeProviderError(err, 'gemini');
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
