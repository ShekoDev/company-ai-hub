import { NextRequest } from 'next/server';
import { gateway } from '@/lib/ai/gateway';
import { AIError } from '@/lib/ai/errors';
import type { ChatRequest, RequestContext } from '@/lib/ai/types';

// Node runtime لأن الـ SDKs محتاجاه، و streaming بيشتغل عادي
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * مؤقت: بيرجع مستخدم وهمي.
 * في المرحلة الجاية ده هيتحول لتحقق من Firebase ID Token:
 *   const decoded = await getAuth().verifyIdToken(token)
 * ولو التوكن غلط بيرجع 401 قبل أي حاجة تانية.
 */
async function authenticate(req: NextRequest): Promise<RequestContext> {
  const header = req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token && process.env.NODE_ENV === 'production') {
    throw new AIError('unauthorized', { providerMessage: 'لا يوجد توكن' });
  }

  return {
    userId: req.headers.get('x-debug-user') ?? 'dev-user',
    ip: req.headers.get('x-forwarded-for') ?? undefined,
  };
}

export async function POST(req: NextRequest) {
  let ctx: RequestContext;
  try {
    ctx = await authenticate(req);
  } catch (err) {
    const e = err as AIError;
    return Response.json(e.toClientJSON(), { status: 401 });
  }

  let body: ChatRequest & { stream?: boolean; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      new AIError('bad_request', { providerMessage: 'JSON غير صالح' }).toClientJSON(),
      { status: 400 },
    );
  }

  ctx.conversationId = body.conversationId;

  const chatRequest: ChatRequest = {
    model: body.model,
    messages: body.messages,
    system: body.system,
    temperature: body.temperature,
    maxOutputTokens: body.maxOutputTokens,
    // لو المستخدم قفل الصفحة بنوقف الطلب فورًا عشان مندفعش تكلفة على الفاضي
    signal: req.signal,
  };

  /* -------------------- الوضع العادي -------------------- */
  if (!body.stream) {
    try {
      const result = await gateway.chat(chatRequest, ctx);
      return Response.json(result);
    } catch (err) {
      const e = err instanceof AIError ? err : new AIError('unknown', { cause: err });
      if (e.code === 'unknown') console.error('[api/chat]', err);
      return Response.json(e.toClientJSON(), { status: e.status });
    }
  }

  /* -------------------- وضع الـ Streaming (SSE) -------------------- */
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of gateway.stream(chatRequest, ctx)) {
          send(event);
        }
      } catch (err) {
        // الـ gateway بيحوّل أخطاءه لأحداث، فده للطوارئ بس
        const e = err instanceof AIError ? err : new AIError('unknown', { cause: err });
        send({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // بيمنع nginx من تجميع الرد وتعطيل الـ streaming
      'X-Accel-Buffering': 'no',
    },
  });
}
