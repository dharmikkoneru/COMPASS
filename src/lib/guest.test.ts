import { describe, expect, it } from 'vitest';
import { GUEST_EMAIL, GUEST_PASSWORD, isGuestEmail } from './guest';

describe('guest helpers', () => {
  it('matches the guest email case-insensitively', () => {
    expect(isGuestEmail('demo@compass.gov.in')).toBe(true);
    expect(isGuestEmail('Demo@Compass.GOV.IN')).toBe(true);
  });

  it('rejects other addresses, including near-misses', () => {
    expect(isGuestEmail('officer@mospi.gov.in')).toBe(false);
    expect(isGuestEmail('demo2@compass.gov.in')).toBe(false);
    expect(isGuestEmail('demo@compass.gov.in.evil.com')).toBe(false);
  });

  it('treats missing emails as not-guest', () => {
    expect(isGuestEmail(null)).toBe(false);
    expect(isGuestEmail(undefined)).toBe(false);
    expect(isGuestEmail('')).toBe(false);
  });

  it('keeps the credentials in sync with the 0010 contract', () => {
    // A guard against editing one side of the demo credential and not the other.
    expect(GUEST_EMAIL).toBe('demo@compass.gov.in');
    expect(GUEST_PASSWORD).toMatch(/^Compass-Guest-\d{4}$/);
  });
});
