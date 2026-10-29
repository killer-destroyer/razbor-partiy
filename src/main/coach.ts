import Anthropic from '@anthropic-ai/sdk'
import type { CoachRequest, CoachResponse } from '../shared/types'

const MODELS_WITH_DEFAULT_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'])

const SYSTEM_PROMPT = `Ты опытный шахматный тренер. Пользователь присылает JSON с разбором своей партии: ходы, оценки движка Stockfish, классы ходов, дебют, точность и автоматические комментарии.
Напиши живой разбор на русском языке для игрока уровня, указанного в данных:
1. Коротко о дебюте и о том, где игрок вышел из теории.
2. Два-три ключевых момента партии: что произошло, почему ход был плох или хорош, какой план был правильным.
3. Повторяющиеся ошибки и их причина в мышлении (а не только в конкретных ходах).
4. Три конкретных совета на следующие партии.
Опирайся только на присланные оценки и варианты, не придумывай свои варианты без опоры на данные. Пиши ходы в русской нотации (Кр, Ф, Л, С, К). Без лишних вступлений.`

export async function requestCoachReview(apiKey: string, request: CoachRequest): Promise<CoachResponse> {
  const client = new Anthropic({ apiKey, maxRetries: 2 })
  const fallback = MODELS_WITH_DEFAULT_FALLBACK.has(request.model)
  try {
    const response = await client.beta.messages.create({
      model: request.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request.payload }],
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
    })
    if (response.stop_reason === 'refusal') {
      return { text: '', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, error: 'Модель отказалась отвечать на этот запрос.' }
    }
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      error: response.stop_reason === 'max_tokens' ? 'Ответ обрезан по длине.' : null
    }
  } catch (error) {
    let message = 'Не удалось связаться с Claude API.'
    if (error instanceof Anthropic.AuthenticationError) message = 'Неверный ключ Anthropic API.'
    else if (error instanceof Anthropic.PermissionDeniedError) message = 'У ключа нет доступа к выбранной модели.'
    else if (error instanceof Anthropic.NotFoundError) message = 'Модель не найдена. Выберите другую в настройках.'
    else if (error instanceof Anthropic.RateLimitError) message = 'Превышен лимит запросов, попробуйте позже.'
    else if (error instanceof Anthropic.BadRequestError) message = `Запрос отклонён: ${error.message}`
    else if (error instanceof Anthropic.APIConnectionError) message = 'Нет соединения с api.anthropic.com.'
    else if (error instanceof Anthropic.APIError) message = `Ошибка API ${error.status ?? ''}: ${error.message}`
    return { text: '', inputTokens: 0, outputTokens: 0, error: message }
  }
}
