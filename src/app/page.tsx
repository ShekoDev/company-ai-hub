'use client';

import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* أنواع محلية — نفس شكل اللي بيرجعه /api/models و /api/chat            */
/* ------------------------------------------------------------------ */

interface ModelOption {
  id: string;
  label: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'nvidia';
  capabilities: string[];
  contextWindow: number;
}

interface MessageMeta {
  model?: string;
  costUsd?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  meta?: MessageMeta;
  error?: string;
}

interface ApiChatResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number;
  finishReason: string;
  latencyMs: number;
}

type StreamEvent =
  | { type: 'start'; model: string; provider: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: ApiChatResult }
  | { type: 'error'; code: string; message: string; retryable: boolean };

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Claude',
  nvidia: 'NVIDIA (تجريبي)',
};

/* ------------------------------------------------------------------ */

export default function ChatPage() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* تحميل قائمة الموديلات أول ما الصفحة تفتح */
  useEffect(() => {
    let cancelled = false;

    fetch('/api/models')
      .then((r) => r.json())
      .then((data: { models: ModelOption[] }) => {
        if (cancelled) return;
        setModels(data.models ?? []);
        // نفضّل موديل NVIDIA بالظبط — هو الوحيد المتأكدين إن مفتاحه شغال دلوقتي
        const preferred =
          data.models?.find((m) => m.id === 'nvidia-balanced') ??
          data.models?.find((m) => m.provider === 'nvidia') ??
          data.models?.[0];
        if (preferred) setSelectedModel(preferred.id);
      })
      .catch(() => {
        if (!cancelled) setLoadError('تعذّر تحميل قائمة الموديلات. جرّب تحدّث الصفحة.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* التمرير لآخر رسالة تلقائيًا */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function stopGenerating() {
    abortRef.current?.abort();
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || busy || !selectedModel) return;

    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // مؤقت لحد ما يتضاف Firebase Auth الحقيقي — شوف authenticate() في api/chat/route.ts
          'x-debug-user': 'employee-dev',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';

      // لو الرد مش SSE (401 مثلًا من authenticate()) بيرجع JSON عادي
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => null);
        const message = data?.error?.message ?? 'حصل خطأ غير متوقع.';
        setMessages((prev) => updateLastAssistant(prev, (m) => ({ ...m, error: message })));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('لا يوجد رد قابل للقراءة');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          if (event.type === 'delta') {
            accumulated += event.text;
            const snapshot = accumulated;
            setMessages((prev) => updateLastAssistant(prev, (m) => ({ ...m, content: snapshot })));
          } else if (event.type === 'done') {
            const r = event.result;
            setMessages((prev) =>
              updateLastAssistant(prev, (m) => ({
                ...m,
                content: r.text || m.content,
                meta: {
                  model: r.model,
                  costUsd: r.costUsd,
                  latencyMs: r.latencyMs,
                  inputTokens: r.usage.inputTokens,
                  outputTokens: r.usage.outputTokens,
                  finishReason: r.finishReason,
                },
              })),
            );
          } else if (event.type === 'error') {
            setMessages((prev) => updateLastAssistant(prev, (m) => ({ ...m, error: event.message })));
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setMessages((prev) => updateLastAssistant(prev, (m) => ({ ...m, error: 'تعذّر الاتصال بالخادم.' })));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const grouped = groupByProvider(models);

  return (
    <div className="page">
      <header className="header">
        <div className="brand">Company AI Hub</div>
        <select
          className="model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={!models.length}
        >
          {!models.length && <option>جاري تحميل الموديلات...</option>}
          {Object.entries(grouped).map(([provider, group]) => (
            <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
              {group.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </header>

      {loadError && <div className="banner banner-error">{loadError}</div>}

      <main className="chat" ref={scrollRef}>
        {!messages.length && (
          <div className="empty-state">
            ابدأ محادثة جديدة — اختار الموديل من فوق واكتب سؤالك تحت.
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            <div className="bubble-content">{m.content || (busy && i === messages.length - 1 ? '…' : '')}</div>
            {m.error && <div className="bubble-error">⚠ {m.error}</div>}
            {m.meta && (
              <div className="bubble-meta">
                {m.meta.inputTokens ?? 0} إدخال / {m.meta.outputTokens ?? 0} إخراج · $
                {m.meta.costUsd?.toFixed(6) ?? '0'} · {m.meta.latencyMs}ms
              </div>
            )}
          </div>
        ))}
      </main>

      <footer className="composer">
        <textarea
          className="composer-input"
          placeholder="اكتب رسالتك... (Enter للإرسال، Shift+Enter لسطر جديد)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          rows={1}
        />
        {busy ? (
          <button className="btn btn-stop" onClick={stopGenerating}>
            إيقاف
          </button>
        ) : (
          <button className="btn btn-send" onClick={sendMessage} disabled={!input.trim() || !selectedModel}>
            إرسال
          </button>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function updateLastAssistant(
  messages: ChatMessage[],
  updater: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (!messages.length) return messages;
  const next = [...messages];
  const lastIndex = next.length - 1;
  next[lastIndex] = updater(next[lastIndex]);
  return next;
}

function groupByProvider(models: ModelOption[]): Record<string, ModelOption[]> {
  return models.reduce<Record<string, ModelOption[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});
}
