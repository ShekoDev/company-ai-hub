/**
 * أخطاء موحدة. كل مزود بيرجع شكل خطأ مختلف — هنا بنحوّلهم لنوع واحد
 * عشان الواجهة والـ Audit Log يتعاملوا مع كود واحد بس.
 */

export type AIErrorCode =
  | 'unauthorized'        // مفتاح API غلط أو ناقص
  | 'forbidden'           // الموظف ملهوش صلاحية على الموديل ده
  | 'session_expired'     // وقت استخدام الموديل خلص
  | 'quota_exceeded'      // تخطى الحد المسموح
  | 'rate_limited'        // ضغط على المزود — يعاد المحاولة
  | 'context_too_long'    // المحادثة أطول من نافذة الموديل
  | 'content_filter'      // المحتوى مرفوض من المزود
  | 'bad_request'
  | 'model_not_found'
  | 'provider_unavailable'
  | 'timeout'
  | 'aborted'
  | 'unknown';

/** الأكواد اللي ينفع يتعاد فيها الطلب تلقائيًا */
const RETRYABLE: AIErrorCode[] = ['rate_limited', 'provider_unavailable', 'timeout'];

const HTTP_STATUS: Record<AIErrorCode, number> = {
  unauthorized: 500,        // مفتاح الشركة غلط — مشكلة سيرفر مش مشكلة الموظف
  forbidden: 403,
  session_expired: 403,
  quota_exceeded: 429,
  rate_limited: 429,
  context_too_long: 400,
  content_filter: 400,
  bad_request: 400,
  model_not_found: 404,
  provider_unavailable: 502,
  timeout: 504,
  aborted: 499,
  unknown: 500,
};

/** رسائل بالعربي تُعرض للموظف — من غير أي تفاصيل داخلية */
const USER_MESSAGE: Record<AIErrorCode, string> = {
  unauthorized: 'في مشكلة في إعدادات الخدمة. تواصل مع الإدارة.',
  forbidden: 'ملكش صلاحية استخدام الموديل ده.',
  session_expired: 'وقت استخدامك للموديل ده انتهى. اطلب وقت إضافي من الإدارة.',
  quota_exceeded: 'وصلت للحد الأقصى المسموح من الاستخدام.',
  rate_limited: 'ضغط على الخدمة دلوقتي. حاول تاني بعد شوية.',
  context_too_long: 'المحادثة بقت طويلة أوي. ابدأ محادثة جديدة.',
  content_filter: 'المحتوى ده مرفوض من مزود الخدمة.',
  bad_request: 'الطلب غير صالح.',
  model_not_found: 'الموديل ده مش متاح.',
  provider_unavailable: 'الخدمة مش متاحة حاليًا. حاول تاني بعد شوية.',
  timeout: 'الطلب استغرق وقت طويل. حاول تاني.',
  aborted: 'تم إلغاء الطلب.',
  unknown: 'حصل خطأ غير متوقع.',
};

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly provider?: string;
  readonly status: number;
  readonly retryable: boolean;
  /** الرسالة الأصلية من المزود — للـ logs فقط، متتبعتش للمتصفح */
  readonly providerMessage?: string;

  constructor(
    code: AIErrorCode,
    opts: { provider?: string; providerMessage?: string; cause?: unknown } = {},
  ) {
    super(USER_MESSAGE[code]);
    this.name = 'AIError';
    this.code = code;
    this.provider = opts.provider;
    this.providerMessage = opts.providerMessage;
    this.status = HTTP_STATUS[code];
    this.retryable = RETRYABLE.includes(code);
    if (opts.cause) this.cause = opts.cause;
  }

  /** الشكل الآمن اللي يترجع للمتصفح */
  toClientJSON() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

/**
 * تحويل خطأ أي SDK لـ AIError.
 * الـ SDKs الثلاثة بتستخدم نفس نمط الـ status، فبنعتمد عليه أساسًا.
 */
export function normalizeProviderError(err: unknown, provider: string): AIError {
  if (err instanceof AIError) return err;

  const e = err as {
    status?: number;
    name?: string;
    message?: string;
    error?: { message?: string; code?: string; status?: string };
  };

  const providerMessage = e?.error?.message ?? e?.message ?? String(err);
  const base = { provider, providerMessage, cause: err };

  if (e?.name === 'AbortError') return new AIError('aborted', base);

  const status = e?.status ?? parseGoogleStatus(providerMessage);

  switch (status) {
    case 400: {
      const m = providerMessage.toLowerCase();
      if (m.includes('context') || m.includes('too long') || m.includes('maximum') || m.includes('token'))
        return new AIError('context_too_long', base);
      if (m.includes('safety') || m.includes('blocked') || m.includes('filter'))
        return new AIError('content_filter', base);
      return new AIError('bad_request', base);
    }
    case 401:
    case 403:
      return new AIError('unauthorized', base);
    case 404:
      return new AIError('model_not_found', base);
    case 408:
      return new AIError('timeout', base);
    case 413:
      return new AIError('context_too_long', base);
    case 429:
      return new AIError('rate_limited', base);
    case 500:
    case 502:
    case 503:
    case 529:
      return new AIError('provider_unavailable', base);
    case 504:
      return new AIError('timeout', base);
  }

  if (/timeout|etimedout|econnreset|fetch failed/i.test(providerMessage))
    return new AIError('timeout', base);

  return new AIError('unknown', base);
}

/** Google أحيانًا بترمي الكود جوه نص الرسالة بدل خاصية status */
function parseGoogleStatus(message: string): number | undefined {
  const m = message.match(/"code"\s*:\s*(\d{3})|\[(\d{3})\s/);
  const code = m?.[1] ?? m?.[2];
  return code ? Number(code) : undefined;
}
