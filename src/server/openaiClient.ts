import OpenAI from 'openai';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { doc, getDoc, setDoc } from './adminFirestore.js';

let memoryOpenAIApiKey = process.env.OPENAI_API_KEY || '';

/**
 * Retrieves the currently active OpenAI API Key from memory, process.env, or Firestore.
 */
export async function getOpenAIApiKey(): Promise<string> {
  if (memoryOpenAIApiKey) {
    return memoryOpenAIApiKey;
  }

  if (process.env.OPENAI_API_KEY) {
    memoryOpenAIApiKey = process.env.OPENAI_API_KEY;
    return memoryOpenAIApiKey;
  }

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'system_settings', 'openai_config'));
      if (snap.exists()) {
        const data = snap.data();
        if (data?.apiKey) {
          memoryOpenAIApiKey = data.apiKey;
          return memoryOpenAIApiKey;
        }
      }
    } catch (err) {
      console.warn('[OpenAI Client] Error reading key from Firestore:', err);
    }
  }

  return '';
}

/**
 * Saves or updates the OpenAI API Key in memory and Firestore.
 */
export async function setOpenAIApiKey(key: string): Promise<boolean> {
  memoryOpenAIApiKey = key.trim();
  process.env.OPENAI_API_KEY = memoryOpenAIApiKey;

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(
        doc(db, 'system_settings', 'openai_config'),
        {
          apiKey: memoryOpenAIApiKey,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return true;
    } catch (err) {
      console.warn('[OpenAI Client] Error saving key to Firestore:', err);
    }
  }
  return true;
}

export interface OpenAIRequestOptions {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  jsonMode?: boolean;
  models?: string[];
  maxTokens?: number;
}

/**
 * Executes a text or JSON completion using OpenAI with automatic multi-model fallback.
 */
export async function generateOpenAICompletion(options: OpenAIRequestOptions): Promise<string> {
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const openai = new OpenAI({ apiKey });
  const candidateModels = options.models && options.models.length > 0 
    ? options.models 
    : ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.userPrompt });

  for (const model of candidateModels) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 1000,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      });

      const responseText = completion.choices?.[0]?.message?.content?.trim() || '';
      if (responseText) {
        return responseText;
      }
    } catch (err: any) {
      console.warn(`[OpenAI Model ${model}] Error:`, err?.message || err);
      // If quota or auth error on first attempt, we continue to check other models or propagate
      if (candidateModels.indexOf(model) === candidateModels.length - 1) {
        throw err;
      }
    }
  }

  throw new Error('All OpenAI candidate models failed to return content.');
}
