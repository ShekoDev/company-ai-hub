/**
 * اختبار محلي للـ Adapters بمفاتيح حقيقية.
 *
 *   npm run test:ai              # كل المزودين المتاحين
 *   npm run test:ai -- openai    # مزود واحد
 *
 * بيتأكد من: الرد العادي، الـ streaming، عدّ التوكنز، حساب التكلفة،
 * توحيد الأخطاء، والإلغاء عن طريق AbortSignal.
 */
import 'dotenv/config';
import { AIGateway } from '../src/lib/ai/gateway';
import { AIError } from '../src/lib/ai/errors';
import { listModels } from '../src/lib/ai/models';
import type { ProviderId, RequestContext } from '../src/lib/ai/types';

const ctx: RequestContext = { userId: 'test-user', conversationId: 'test-convo' };

const gateway = new AIGateway({
  onUsage: () => {}, // بنطبع بنفسنا تحت
});

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const pass = (m: string) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const fail = (m: string) => console.log(`  ${RED}✗${RESET} ${m}`);
const info = (m: string) => console.log(`  ${DIM}${m}${RESET}`);

let failures = 0;

async function testModel(modelId: string) {
  console.log(`\n▸ ${modelId}`);

  /* --- 1) رد عادي --- */
  try {
    const res = await gateway.chat(
      {
        model: modelId,
        system: 'أجب بالعربية في جملة واحدة قصيرة جدًا.',
        messages: [{ role: 'user', content: 'ما هي عاصمة مصر؟' }],
        maxOutputTokens: 200,
        temperature: 0,
      },
      ctx,
    );

    if (!res.text.trim()) throw new Error('رد فاضي');
    pass(`رد عادي — "${res.text.trim().slice(0, 60)}"`);
    info(
      `توكنز: ${res.usage.inputTokens} إدخال / ${res.usage.outputTokens} إخراج · ` +
        `تكلفة: $${res.costUsd} · ${res.latencyMs}ms · انتهى بـ: ${res.finishReason}`,
    );

    if (res.usage.inputTokens === 0) fail('عدّ توكنز الإدخال رجع صفر — راجع مابنج الـ usage');
  } catch (err) {
    failures++;
    fail(`رد عادي — ${err instanceof AIError ? `[${err.code}] ${err.providerMessage}` : err}`);
    return; // مفيش فايدة نكمل لو الأساسي وقع
  }

  /* --- 2) streaming --- */
  try {
    let chunks = 0;
    let streamed = '';
    let doneEvent: { usage: { inputTokens: number; outputTokens: number }; costUsd: number } | null =
      null;

    for await (const event of gateway.stream(
      {
        model: modelId,
        system: 'أجب بالعربية.',
        messages: [{ role: 'user', content: 'عد من 1 لـ 5 بالكلمات، كل رقم في سطر.' }],
        maxOutputTokens: 300,
        temperature: 0,
      },
      ctx,
    )) {
      if (event.type === 'delta') {
        chunks++;
        streamed += event.text;
      } else if (event.type === 'done') {
        doneEvent = event.result;
      } else if (event.type === 'error') {
        throw new Error(`[${event.code}] ${event.message}`);
      }
    }

    if (chunks < 2) throw new Error(`وصل ${chunks} chunk بس — يبدو إن الـ streaming مش شغال`);
    if (!doneEvent) throw new Error('حدث done مجاش');

    pass(`streaming — ${chunks} chunk، ${streamed.length} حرف`);
    info(
      `توكنز: ${doneEvent.usage.inputTokens} إدخال / ${doneEvent.usage.outputTokens} إخراج · ` +
        `تكلفة: $${doneEvent.costUsd}`,
    );

    if (doneEvent.usage.outputTokens === 0)
      fail('توكنز الإخراج في الـ streaming رجعت صفر — راجع مابنج الـ usage');
  } catch (err) {
    failures++;
    fail(`streaming — ${err}`);
  }

  /* --- 3) الإلغاء --- */
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);

    let aborted = false;
    try {
      for await (const event of gateway.stream(
        {
          model: modelId,
          messages: [{ role: 'user', content: 'اكتب مقال طويل جدًا عن تاريخ مصر.' }],
          maxOutputTokens: 4000,
          signal: controller.signal,
        },
        ctx,
      )) {
        if (event.type === 'error' && event.code === 'aborted') aborted = true;
      }
    } catch (err) {
      if (err instanceof AIError && err.code === 'aborted') aborted = true;
      else throw err;
    }

    if (aborted) pass('الإلغاء بـ AbortSignal اشتغل صح');
    else fail('الإلغاء ما اتحولش لكود aborted — راجع normalizeProviderError');
  } catch (err) {
    failures++;
    fail(`الإلغاء — ${err}`);
  }
}

async function testErrorHandling() {
  console.log('\n▸ توحيد الأخطاء');

  try {
    await gateway.chat({ model: 'موديل-مش-موجود', messages: [{ role: 'user', content: 'hi' }] }, ctx);
    failures++;
    fail('موديل غير موجود — المفروض يرمي خطأ');
  } catch (err) {
    if (err instanceof AIError && err.code === 'model_not_found') pass('موديل غير موجود → model_not_found');
    else {
      failures++;
      fail(`موديل غير موجود → ${err}`);
    }
  }

  try {
    await gateway.chat({ model: listModels()[0].id, messages: [] }, ctx);
    failures++;
    fail('رسائل فاضية — المفروض يرمي خطأ');
  } catch (err) {
    if (err instanceof AIError && err.code === 'bad_request') pass('رسائل فاضية → bad_request');
    else {
      failures++;
      fail(`رسائل فاضية → ${err}`);
    }
  }
}

async function main() {
  const only = process.argv[2] as ProviderId | undefined;

  console.log('═══ اختبار AI Gateway ═══');

  const available = gateway.listModels();
  if (!available.length) {
    console.log(`\n${RED}مفيش أي مفتاح API مضبوط.${RESET} انسخ .env.example لـ .env وحط المفاتيح.`);
    process.exit(1);
  }

  // موديل واحد من كل مزود يكفي — الباقي نفس الكود
  const seen = new Set<ProviderId>();
  const targets = available.filter((m) => {
    if (only && m.provider !== only) return false;
    if (seen.has(m.provider)) return false;
    seen.add(m.provider);
    return true;
  });

  console.log(`المزودين المضبوطين: ${[...seen].join(', ')}`);

  await testErrorHandling();
  for (const m of targets) await testModel(m.id);

  console.log(
    failures === 0
      ? `\n${GREEN}كل الاختبارات نجحت ✓${RESET}\n`
      : `\n${RED}${failures} اختبار فشل${RESET}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
