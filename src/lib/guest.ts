// Guest demo access — shared constants and helpers.
//
// The guest account is created by supabase/migrations/0010_guest_access.sql;
// the password there (crypt('Compass-Guest-2026', ...)) must match
// GUEST_PASSWORD. This is a demo credential by design — rotate both files
// together if the deployment ever leaves demo duty.

export const GUEST_EMAIL = 'demo@compass.gov.in';
export const GUEST_PASSWORD = 'Compass-Guest-2026';

/** True when the signed-in session is the shared guest demo account. */
export function isGuestEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === GUEST_EMAIL;
}
