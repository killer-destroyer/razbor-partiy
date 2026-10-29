export const COACH_MODELS: Array<{ id: string; label: string; inputPerMillion: number; outputPerMillion: number }> = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inputPerMillion: 2, outputPerMillion: 10 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', inputPerMillion: 4, outputPerMillion: 20 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', inputPerMillion: 0.1, outputPerMillion: 0.5 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', inputPerMillion: 10, outputPerMillion: 50 }
]

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = COACH_MODELS.find((entry) => entry.id === model) ?? COACH_MODELS[0]
  return (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2)
}
