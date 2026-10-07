import type { ModelEntry } from './types';

/**
 * Model Registry — المصدر الوحيد للحقيقة عن الموديلات المتاحة.
 *
 * قاعدة مهمة: الـ `id` هو اللي بيتخزن في صلاحيات الموظف وفي Firestore،
 * فلازم يفضل ثابت للأبد. لما المزود يطلع نسخة أحدث بنغيّر `providerModel` بس
 * ومحدش في المنصة بيحس بالفرق ولا الصلاحيات القديمة بتتكسر.
 *
 * الأسعار بالدولار لكل مليون توكن — راجعها دوريًا (آخر تحديث: أغسطس 2026).
 */
export const MODELS: ModelEntry[] = [
  /* ---------------- OpenAI ---------------- */
  {
    id: 'gpt-flagship',
    label: 'GPT — الأقوى',
    provider: 'openai',
    providerModel: 'gpt-5.6-sol',
    capabilities: ['text', 'vision', 'files'],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: { inputPerMTok: 2.5, outputPerMTok: 15 },
    enabled: true,
  },
  {
    id: 'gpt-balanced',
    label: 'GPT — متوازن',
    provider: 'openai',
    providerModel: 'gpt-5.6-terra',
    capabilities: ['text', 'vision', 'files'],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: { inputPerMTok: 1, outputPerMTok: 6 },
    enabled: true,
  },
  {
    id: 'gpt-fast',
    label: 'GPT — سريع واقتصادي',
    provider: 'openai',
    providerModel: 'gpt-5.6-luna',
    capabilities: ['text', 'vision'],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.6 },
    enabled: true,
  },

  /* ---------------- Google Gemini ---------------- */
  {
    id: 'gemini-flagship',
    label: 'Gemini — الأقوى',
    provider: 'gemini',
    providerModel: 'gemini-3.7-flash',
    capabilities: ['text', 'vision', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    pricing: { inputPerMTok: 0.75, outputPerMTok: 3.75 },
    enabled: true,
  },
  {
    id: 'gemini-fast',
    label: 'Gemini — سريع واقتصادي',
    provider: 'gemini',
    providerModel: 'gemini-3.5-flash-lite',
    capabilities: ['text', 'vision'],
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    pricing: { inputPerMTok: 0.3, outputPerMTok: 2.5 },
    enabled: true,
  },

  /* ---------------- Anthropic Claude ---------------- */
  {
    id: 'claude-flagship',
    label: 'Claude — الأقوى',
    provider: 'anthropic',
    providerModel: 'claude-opus-5',
    capabilities: ['text', 'vision', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMTok: 5, outputPerMTok: 25 },
    enabled: true,
  },
  {
    id: 'claude-balanced',
    label: 'Claude — متوازن',
    provider: 'anthropic',
    providerModel: 'claude-sonnet-5',
    capabilities: ['text', 'vision', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    enabled: true,
  },
  {
    id: 'claude-fast',
    label: 'Claude — سريع واقتصادي',
    provider: 'anthropic',
    providerModel: 'claude-haiku-4-5-20251001',
    capabilities: ['text', 'vision'],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMTok: 1, outputPerMTok: 5 },
    enabled: true,
  },

  /* ---------------- NVIDIA NIM ---------------- */
  {
    id: 'nvidia-flagship',
    label: 'NVIDIA — الأقوى (تجريبي)',
    provider: 'nvidia',
    providerModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    capabilities: ['text', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    // TODO: مفتاح تجريبي من NIM Free Tier — راجع التسعير قبل الإنتاج الفعلي
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    enabled: true,
  },
  {
    id: 'nvidia-balanced',
    label: 'NVIDIA — متوازن (تجريبي)',
    provider: 'nvidia',
    // الأكتر استخدامًا من موديلات NVIDIA على المنصة كلها (65M استدعاء/شهر وقت الكتابة)
    providerModel: 'nvidia/nemotron-3-super-120b-a12b',
    capabilities: ['text', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    enabled: true,
  },
  {
    id: 'nvidia-fast',
    label: 'NVIDIA — سريع واقتصادي (تجريبي)',
    provider: 'nvidia',
    // nemotron-3-nano-30b-a3b كان هنا بس صفحته بتاعته بتحذّر إنه Deprecated
    // اعتبارًا من 25/8/2026 (النهارده بالظبط) — استبدلته بـ Lightning
    providerModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    capabilities: ['text', 'files'],
    contextWindow: 1_000_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    enabled: true,
  },
  {
    id: 'nvidia-omni',
    label: 'NVIDIA — صوت وفيديو (تجريبي)',
    provider: 'nvidia',
    providerModel: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    capabilities: ['text', 'vision', 'files', 'audio', 'video'],
    contextWindow: 262_000,
    maxOutputTokens: 65_536,
    // TODO: مفتاح تجريبي من NIM Free Tier (بدون SLA، حد ~40 request/minute).
    // التسعير لسه مش مؤكد رسميًا — راجعه في build.nvidia.com قبل أي استخدام فعلي
    // مع الموظفين، وحدّث الأرقام دي أول ما تعرف السعر الحقيقي.
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    enabled: true,
  },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelEntry | undefined {
  return BY_ID.get(id);
}

export function listModels(): ModelEntry[] {
  return MODELS.filter((m) => m.enabled);
}

/** حساب التكلفة التقريبية — بيتخزن في Usage Tracking */
export function calculateCost(
  entry: ModelEntry,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const cost =
    (usage.inputTokens / 1_000_000) * entry.pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * entry.pricing.outputPerMTok;
  // 6 أرقام عشرية تكفي — الطلب الواحد ممكن يكون أقل من سنت
  return Number(cost.toFixed(6));
}
