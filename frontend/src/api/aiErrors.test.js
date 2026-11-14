import { describe, it, expect } from 'vitest'
import { ApiError } from './client'
import { AI_NOT_CONFIGURED_TEXT, aiErrorText, isAINotConfigured } from './aiErrors'

describe('aiErrors', () => {
  it('recognises the server\'s "AI is not configured" 503', () => {
    expect(isAINotConfigured(new ApiError('AI is not configured', 503))).toBe(true)
    expect(isAINotConfigured(new ApiError('AI is not configured', 500))).toBe(false)
    expect(isAINotConfigured(new ApiError('The AI service is temporarily busy.', 503))).toBe(false)
  })

  it('turns it into one clear message, and leaves other errors as they are', () => {
    expect(aiErrorText(new ApiError('AI is not configured', 503))).toBe(AI_NOT_CONFIGURED_TEXT)
    expect(AI_NOT_CONFIGURED_TEXT).toMatch(/^AI is not configured on this server/)
    expect(aiErrorText(new ApiError('Quota reached', 503))).toBe('Quota reached')
    expect(aiErrorText(new Error(''), 'fallback')).toBe('fallback')
  })
})
