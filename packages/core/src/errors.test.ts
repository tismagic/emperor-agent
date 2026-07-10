import { describe, expect, it } from 'vitest'
import {
  EmperorError,
  ParseError,
  StoreCorruptError,
  ValidationError,
  toSafeError,
} from './errors'

describe('errors', () => {
  it('carries a stable code and a safe projection', () => {
    const err = new EmperorError('boom', 'my_code')
    expect(err.code).toBe('my_code')
    expect(err.name).toBe('EmperorError')
    expect(err.toSafe()).toEqual({ code: 'my_code', message: 'boom' })
  })

  it('subclasses set their own code and name', () => {
    expect(new ParseError('x').code).toBe('parse_error')
    expect(new ValidationError('x').code).toBe('validation_error')
    const corrupt = new StoreCorruptError('bad', '/tmp/x.corrupt-1')
    expect(corrupt.code).toBe('store_corrupt')
    expect(corrupt.backupPath).toBe('/tmp/x.corrupt-1')
    expect(corrupt.name).toBe('StoreCorruptError')
  })

  it('toSafeError never leaks internal stacks', () => {
    expect(toSafeError(new ValidationError('nope'))).toEqual({
      code: 'validation_error',
      message: 'nope',
    })
    expect(toSafeError(new Error('raw'))).toEqual({
      code: 'internal_error',
      message: 'raw',
    })
    expect(toSafeError('weird')).toEqual({
      code: 'internal_error',
      message: 'weird',
    })
  })
})
