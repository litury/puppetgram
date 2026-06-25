/**
 * LLM-клиент для классификации — OpenAI-совместимый, по умолчанию DeepSeek (дёшево).
 * env: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL.
 */

import OpenAI from 'openai';

export function createLlmClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  });
}

export const LLM_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
