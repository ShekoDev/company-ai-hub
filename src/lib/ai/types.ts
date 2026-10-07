/**
 * العقد المشترك بين كل مزودي الذكاء الاصطناعي.
 * أي موديل جديد لازم ينفّذ الواجهات دي فقط — من غير ما يتغير أي كود في الـ Gateway أو الواجهة.
 */

export type ProviderId = 'openai' | 'gemini' | 'anthropic' | 'nvidia';

export type Capability = 'text' | 'vision' | 'image_generation' | 'files' | 'audio' | 'video';

/* ------------------------------------------------------------------ */
/* الرسائل                                                             */
/* ------------------------------------------------------------------ */

export type MessageRole = 'user' | 'assistant';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  /** مثال: "image/png" */
  mimeType: string;
  /** محتوى الصورة base64 من غير الـ data: prefix */
  data: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
}

/* ------------------------------------------------------------------ */
/* الطلب                                                               */
/* ------------------------------------------------------------------ */

export interface ChatRequest {
  /** المعرّف الداخلي للموديل من الـ Model Registry (مش اسم المزود) */
  model: string;
  messages: ChatMessage[];
  /** تعليمات النظام — بتتحول لصيغة كل مزود تلقائيًا */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** لإلغاء الطلب لو المستخدم قفل الصفحة أو انتهى وقت الـ Session */
  signal?: AbortSignal;
}

/** بيانات المستخدم اللي بتتمرر للـ Gateway لأغراض الصلاحيات والتتبع */
export interface RequestContext {
  userId: string;
  email?: string;
  department?: string;
  conversationId?: string;
  ip?: string;
}

/* ------------------------------------------------------------------ */
/* النتيجة                                                             */
/* ------------------------------------------------------------------ */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** توكنز مقروءة من الكاش (لو المزود بيدعم prompt caching) */
  cachedInputTokens?: number;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'unknown';

export interface ChatResult {
  text: string;
  /** المعرّف الداخلي */
  model: string;
  provider: ProviderId;
  /** الاسم الحقيقي عند المزود */
  providerModel: string;
  usage: TokenUsage;
  /** التكلفة التقريبية بالدولار محسوبة من التسعير في الـ Registry */
  costUsd: number;
  finishReason: FinishReason;
  latencyMs: number;
}

/* ------------------------------------------------------------------ */
/* الـ Streaming                                                       */
/* ------------------------------------------------------------------ */

export type StreamEvent =
  | { type: 'start'; model: string; provider: ProviderId }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: ChatResult }
  | { type: 'error'; code: string; message: string; retryable: boolean };

/* ------------------------------------------------------------------ */
/* واجهة الـ Adapter                                                   */
/* ------------------------------------------------------------------ */

export interface ModelEntry {
  /** المعرّف الداخلي المستخدم في الصلاحيات وقاعدة البيانات — لا يتغير أبدًا */
  id: string;
  /** الاسم المعروض للموظف */
  label: string;
  provider: ProviderId;
  /** الاسم الحقيقي عند المزود — ده اللي بيتغير مع تحديث الموديلات */
  providerModel: string;
  capabilities: Capability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing: {
    /** دولار لكل مليون توكن إدخال */
    inputPerMTok: number;
    /** دولار لكل مليون توكن إخراج */
    outputPerMTok: number;
  };
  /** لو false الموديل مخفي من القائمة من غير ما يتشال من الكود */
  enabled: boolean;
}

/** الطلب بعد ما الـ Gateway يحل الموديل ويتحقق منه */
export interface ResolvedRequest extends Omit<ChatRequest, 'model'> {
  entry: ModelEntry;
}

export interface ProviderAdapter {
  readonly provider: ProviderId;
  /** بيتأكد إن المفتاح موجود قبل أول طلب */
  isConfigured(): boolean;
  chat(req: ResolvedRequest): Promise<ChatResult>;
  stream(req: ResolvedRequest): AsyncGenerator<StreamEvent, void, unknown>;
}
