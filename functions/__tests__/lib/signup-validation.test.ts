import { describe, it, expect } from 'vitest';
import {
  SIGNUP_LIMITS,
  isSignupRequest,
  validateSignupBody,
} from '../../lib/signup-validation';

describe('validateSignupBody', () => {
  const good = { email: 'a@b.co', password: 'longenough!', name: 'Alice' };

  it('accepts a well-formed body', () => {
    expect(validateSignupBody(good)).toBeNull();
  });

  it('accepts a body without a name', () => {
    expect(validateSignupBody({ email: 'a@b.co', password: 'longenough!' })).toBeNull();
  });

  it.each([
    ['missing email', { ...good, email: undefined }],
    ['empty email', { ...good, email: '   ' }],
    ['non-string email', { ...good, email: 123 }],
    ['malformed email', { ...good, email: 'not-an-email' }],
    ['oversize email', { ...good, email: 'a'.repeat(SIGNUP_LIMITS.emailMax) + '@b.co' }],
  ])('rejects %s', (_label, body) => {
    expect(validateSignupBody(body as never)).toMatch(/email/i);
  });

  it.each([
    ['missing password', { ...good, password: undefined }],
    ['short password', { ...good, password: 'short' }],
    ['oversize password', { ...good, password: 'a'.repeat(SIGNUP_LIMITS.passwordMax + 1) }],
    ['non-string password', { ...good, password: 123 }],
  ])('rejects %s', (_label, body) => {
    expect(validateSignupBody(body as never)).toMatch(/password/i);
  });

  it('rejects an oversize name', () => {
    expect(validateSignupBody({ ...good, name: 'x'.repeat(SIGNUP_LIMITS.nameMax + 1) }))
      .toMatch(/name/i);
  });

  it('rejects a non-string name', () => {
    expect(validateSignupBody({ ...good, name: 123 } as never)).toMatch(/name/i);
  });

  it('rejects a non-object body', () => {
    expect(validateSignupBody(null as never)).toBeTruthy();
    expect(validateSignupBody('hello' as never)).toBeTruthy();
  });
});

describe('isSignupRequest', () => {
  it('matches POST /api/auth/sign-up/email', () => {
    expect(isSignupRequest('POST', '/api/auth/sign-up/email')).toBe(true);
  });

  it('matches POST /api/auth/sign-up exactly', () => {
    expect(isSignupRequest('POST', '/api/auth/sign-up')).toBe(true);
  });

  it('does not match GET', () => {
    expect(isSignupRequest('GET', '/api/auth/sign-up/email')).toBe(false);
  });

  it('does not match other auth routes', () => {
    expect(isSignupRequest('POST', '/api/auth/sign-in/email')).toBe(false);
    expect(isSignupRequest('POST', '/api/auth/get-session')).toBe(false);
  });

  it('does not match a path that merely contains "sign-up"', () => {
    expect(isSignupRequest('POST', '/api/auth/not-sign-up-really')).toBe(false);
  });
});
