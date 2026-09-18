/**
 * Password policy shared by signup and reset flows.
 *
 * These client-side rules give instant feedback; they mirror what Supabase
 * Auth enforces server-side once configured in the dashboard (minimum
 * password length + HaveIBeenPwned leaked-password check). The dashboard
 * settings remain the real gate — see SUPABASE_SETUP.md, "Security hardening".
 */

export interface PasswordIssue {
  rule: string;
  message: string;
}

export const MIN_PASSWORD_LENGTH = 10;

export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < MIN_PASSWORD_LENGTH)
    issues.push({ rule: 'length', message: `at least ${MIN_PASSWORD_LENGTH} characters` });
  if (!/[a-z]/.test(password)) issues.push({ rule: 'lower', message: 'a lowercase letter' });
  if (!/[A-Z]/.test(password)) issues.push({ rule: 'upper', message: 'an uppercase letter' });
  if (!/[0-9]/.test(password)) issues.push({ rule: 'digit', message: 'a number' });
  return issues;
}

export function validatePassword(password: string): { ok: boolean; message?: string } {
  const issues = passwordIssues(password);
  if (issues.length === 0) return { ok: true };
  const list = issues.map((i) => i.message).join(', ');
  return { ok: false, message: `Password needs ${list}.` };
}

/** 0 empty · 1 weak · 2 good · 3 strong — drives the strength meter UI. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length === 0) return 0;
  const issues = passwordIssues(password).length;
  if (issues > 1) return 1;
  if (issues === 1) return 2;
  if (password.length < 14) return 2;
  return 3;
}
