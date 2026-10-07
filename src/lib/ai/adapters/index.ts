import type { ProviderAdapter, ProviderId } from '../types';
import { OpenAIAdapter } from './openai';
import { GeminiAdapter } from './gemini';
import { ClaudeAdapter } from './claude';
import { NvidiaAdapter } from './nvidia';

/**
 * سجل الـ Adapters. إضافة مزود جديد = ملف جديد + سطر هنا + مدخل في models.ts.
 * ولا سطر واحد بيتغير في الـ Gateway ولا في الـ API Routes ولا في الواجهة.
 */
export const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  gemini: new GeminiAdapter(),
  anthropic: new ClaudeAdapter(),
  nvidia: new NvidiaAdapter(),
};

export { OpenAIAdapter, GeminiAdapter, ClaudeAdapter, NvidiaAdapter };
