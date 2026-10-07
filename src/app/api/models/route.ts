import { NextRequest } from 'next/server';
import { gateway } from '@/lib/ai/gateway';

export const runtime = 'nodejs';

/**
 * قائمة الموديلات للواجهة.
 * مهم: التسعير و providerModel مبيتبعتوش للمتصفح — دي بيانات داخلية.
 * في المرحلة الجاية هنفلتر القائمة دي حسب صلاحيات الموظف من Firestore.
 */
export async function GET(_req: NextRequest) {
  const models = gateway.listModels().map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    capabilities: m.capabilities,
    contextWindow: m.contextWindow,
  }));

  return Response.json({ models });
}
