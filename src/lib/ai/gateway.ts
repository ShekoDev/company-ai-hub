import type {
  ChatRequest,
  ChatResult,
  ModelEntry,
  RequestContext,
  ResolvedRequest,
  StreamEvent,
} from './types';
import { getModel, listModels } from './models';
import { adapters } from './adapters';
import { AIError } from './errors';

/* ------------------------------------------------------------------ */
/* نقاط الربط — دي اللي هتوصل بـ Firestore في المرحلة الجاية           */
/* ------------------------------------------------------------------ */

/**
 * حارس الصلاحيات والوقت.
 * دلوقتي بيسمح بكل حاجة. لما نبني Permission/Timer System
 * هنمرر تنفيذ حقيقي بيقرأ من Firestore ويرمي AIError('forbidden' | 'session_expired').
 */
export type AccessGuard = (
  ctx: RequestContext,
  entry: ModelEntry,
) => Promise<void> | void;

/** بيتنادى بعد كل طلب ناجح أو فاشل — نقطة ربط الـ Usage Tracking والـ Audit Log */
export type UsageReporter = (record: UsageRecord) => Promise<void> | void;

export interface UsageRecord {
  userId: string;
  conversationId?: string;
  model: string;
  provider: string;
  providerModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  streamed: boolean;
  ok: boolean;
  errorCode?: string;
  at: Date;
}

export interface GatewayOptions {
  guard?: AccessGuard;
  onUsage?: UsageReporter;
}

/* ------------------------------------------------------------------ */
/* الـ Gateway                                                         */
/* ------------------------------------------------------------------ */

export class AIGateway {
  private guard?: AccessGuard;
  private onUsage?: UsageReporter;

  constructor(opts: GatewayOptions = {}) {
    this.guard = opts.guard;
    this.onUsage = opts.onUsage;
  }

  /** الموديلات المتاحة — الفلترة حسب صلاحيات الموظف بتحصل في طبقة أعلى */
  listModels(): ModelEntry[] {
    return listModels().filter((m) => adapters[m.provider].isConfigured());
  }

  /** يحل المعرّف الداخلي لموديل حقيقي ويطبّق حارس الصلاحيات */
  private async resolve(req: ChatRequest, ctx: RequestContext): Promise<ResolvedRequest> {
    const entry = getModel(req.model);
    if (!entry || !entry.enabled) {
      throw new AIError('model_not_found', { providerMessage: `موديل غير معروف: ${req.model}` });
    }
    if (!req.messages?.length) {
      throw new AIError('bad_request', { providerMessage: 'قائمة الرسائل فاضية' });
    }

    // الصلاحيات والوقت بيتفحصوا هنا — قبل أي اتصال بالمزود، يعني قبل أي تكلفة
    await this.guard?.(ctx, entry);

    const { model: _ignored, ...rest } = req;
    return { ...rest, entry };
  }

  private async report(record: UsageRecord) {
    try {
      await this.onUsage?.(record);
    } catch {
      // فشل التتبع مايوقعش الطلب — بس لازم يتسجل في اللوج
      console.error('[ai-gateway] فشل تسجيل الاستخدام');
    }
  }

  /* ---------------- طلب عادي ---------------- */

  async chat(req: ChatRequest, ctx: RequestContext): Promise<ChatResult> {
    const resolved = await this.resolve(req, ctx);
    const adapter = adapters[resolved.entry.provider];

    try {
      const result = await adapter.chat(resolved);
      await this.report({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        model: result.model,
        provider: result.provider,
        providerModel: result.providerModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        streamed: false,
        ok: true,
        at: new Date(),
      });
      return result;
    } catch (err) {
      const e = err instanceof AIError ? err : new AIError('unknown', { cause: err });
      await this.report({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        model: resolved.entry.id,
        provider: resolved.entry.provider,
        providerModel: resolved.entry.providerModel,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        streamed: false,
        ok: false,
        errorCode: e.code,
        at: new Date(),
      });
      throw e;
    }
  }

  /* ---------------- طلب Streaming ---------------- */

  async *stream(
    req: ChatRequest,
    ctx: RequestContext,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const resolved = await this.resolve(req, ctx);
    const adapter = adapters[resolved.entry.provider];

    try {
      for await (const event of adapter.stream(resolved)) {
        if (event.type === 'done') {
          const r = event.result;
          await this.report({
            userId: ctx.userId,
            conversationId: ctx.conversationId,
            model: r.model,
            provider: r.provider,
            providerModel: r.providerModel,
            inputTokens: r.usage.inputTokens,
            outputTokens: r.usage.outputTokens,
            costUsd: r.costUsd,
            latencyMs: r.latencyMs,
            streamed: true,
            ok: true,
            at: new Date(),
          });
        }
        yield event;
      }
    } catch (err) {
      const e = err instanceof AIError ? err : new AIError('unknown', { cause: err });
      await this.report({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        model: resolved.entry.id,
        provider: resolved.entry.provider,
        providerModel: resolved.entry.providerModel,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        streamed: true,
        ok: false,
        errorCode: e.code,
        at: new Date(),
      });

      // في الـ streaming بنبعت الخطأ كحدث بدل ما نرميه —
      // لأن الـ HTTP response يكون بدأ خلاص وميقدرش يرجع status code
      yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable };
    }
  }
}

/** نسخة افتراضية للاستخدام السريع — استبدلها بواحدة فيها guard حقيقي */
export const gateway = new AIGateway({
  onUsage: async (r) => {
    // TODO: اكتب في Firestore collection: usage
    console.log(
      `[usage] ${r.userId} → ${r.model} | in:${r.inputTokens} out:${r.outputTokens} | $${r.costUsd} | ${r.latencyMs}ms | ${r.ok ? 'ok' : r.errorCode}`,
    );
  },
});
