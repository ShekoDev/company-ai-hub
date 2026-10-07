# Company AI Hub — طبقة الـ AI Gateway

المرحلة الأولى من المشروع: طبقة موحّدة تتكلم مع OpenAI و Gemini و Claude من خلال واجهة واحدة، مع دعم الـ Streaming وحساب التكلفة وتوحيد الأخطاء.

## البنية

```
src/lib/ai/
├── types.ts              العقد المشترك — أي مزود جديد ينفّذ ده وبس
├── errors.ts             تحويل أخطاء كل مزود لكود واحد موحّد
├── models.ts             Model Registry + التسعير + حساب التكلفة
├── gateway.ts            الـ Gateway — نقطة الدخول الوحيدة
└── adapters/
    ├── openai.ts         Responses API
    ├── gemini.ts         generateContent / generateContentStream
    └── claude.ts         Messages API

src/app/api/
├── chat/route.ts         POST — يدعم SSE streaming و JSON عادي
└── models/route.ts       GET — قائمة الموديلات المتاحة
```

## التشغيل

```bash
npm install
cp .env.example .env      # حط المفاتيح
npm run test:ai           # اختبار المزودين بمفاتيح حقيقية
npm run dev
```

`npm run test:ai` بيختبر لكل مزود: الرد العادي، الـ streaming، عدّ التوكنز، حساب التكلفة، والإلغاء بـ AbortSignal. تقدر تختبر مزود واحد: `npm run test:ai -- openai`.

## الاستخدام

```ts
import { gateway } from '@/lib/ai/gateway';

// رد كامل
const res = await gateway.chat(
  { model: 'claude-balanced', messages: [{ role: 'user', content: 'أهلاً' }] },
  { userId: 'uid-123' },
);
console.log(res.text, res.usage, res.costUsd);

// streaming
for await (const e of gateway.stream({ model: 'gpt-fast', messages }, ctx)) {
  if (e.type === 'delta') process.stdout.write(e.text);
  if (e.type === 'done') saveUsage(e.result);
  if (e.type === 'error') showError(e.message);
}
```

نفس الكود بالظبط للمزودين الثلاثة. الفرق الوحيد هو `model`.

## قرارات تصميمية مهمة

**المعرّف الداخلي ثابت للأبد.** الصلاحيات في Firestore بتتخزن بـ `claude-balanced` مش `claude-sonnet-5`. لما Anthropic تطلع نسخة أحدث بتغيّر `providerModel` في `models.ts` وخلاص — ولا صلاحية واحدة بتتكسر ولا سطر في الواجهة بيتغير.

**الصلاحيات والوقت بيتفحصوا قبل الاتصال بالمزود.** الـ `AccessGuard` في `gateway.ts` بيشتغل في `resolve()` قبل أي طلب خارجي، يعني قبل أي تكلفة. دلوقتي فاضي — لما نبني Timer System هنمرر تنفيذ بيقرأ من Firestore ويرمي `session_expired` أو `forbidden`.

**الأخطاء في الـ streaming بترجع كحدث مش استثناء.** لأن الـ HTTP response بيكون بدأ خلاص وميقدرش يرجع status code تاني.

**رسائل الخطأ للموظف بالعربي وخالية من أي تفاصيل داخلية.** التفاصيل الحقيقية في `providerMessage` وبتتسجل في اللوج بس.

**`store: false` مع OpenAI.** المحادثات متتخزنش عند المزود — تفضل في Firestore بتاعنا.

**التسعير و `providerModel` مبيتبعتوش للمتصفح.** `/api/models` بيرجع البيانات اللي الواجهة محتاجاها بس.

## اللي لسه ناقص (المرحلة الجاية)

- التحقق من Firebase ID Token في `authenticate()` بدل المستخدم الوهمي
- تنفيذ حقيقي للـ `AccessGuard` (صلاحيات + تايمر من Firestore)
- كتابة `UsageRecord` في Firestore بدل `console.log`
- Chat History + التحقق من ملكية المحادثة
- الملفات والصور (رفع لـ Storage ثم تمرير للموديل)
- Admin Dashboard

## ⚠️ قبل التشغيل الفعلي

المفاتيح دي بتاعة **API Access المدفوع بالاستهلاك**، ومالهاش أي علاقة باشتراك ChatGPT Plus أو Gemini Advanced أو Claude Pro. لازم تفتح حساب API وتفعّل الفوترة عند كل مزود على حدة، وتراجع سياسة كل واحد فيهم بخصوص الاستخدام التجاري وتخزين بيانات الشركة.

الأسعار في `models.ts` آخر تحديث أغسطس 2026 — راجعها دوريًا.
