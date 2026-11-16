import { describe, it, expect } from 'vitest'
import { describeUploadError } from './uploadErrors'

describe('describeUploadError', () => {
  it('explains the per-minute upload limit', () => {
    expect(describeUploadError({ status: 429, message: 'Too many requests (30 per 1 minute).' })).toEqual({
      title: 'Too many uploads',
      description: 'You can upload up to 30 files a minute. Wait a moment, then try again.',
    })
  })

  it("shows the server's reason when the project's file space is full", () => {
    const msg = 'This project already has 200 uploaded files, the most it can hold. Delete some to upload more.'
    expect(describeUploadError({ status: 409, message: msg })).toEqual({ title: "This project's file space is full", description: msg })
  })

  it('leaves every other error alone', () => {
    for (const status of [400, 403, 413, 415, 502]) expect(describeUploadError({ status, message: 'x' })).toBeNull()
    expect(describeUploadError(new Error('network'))).toBeNull()
  })
})
