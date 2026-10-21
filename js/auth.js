import { supabase } from './supabase.js';

// ─── Sign Up ────────────────────────────────────────────────────────────────
export async function signUp(email, password, metadata, captchaToken) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata, captchaToken } });
  if (error) throw error;
  return data;
}

// ─── Sign In ────────────────────────────────────────────────────────────────
export async function signIn(email, password, captchaToken) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) throw error;
  return data;
}

// ─── Sign Out ───────────────────────────────────────────────────────────────
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  try { sessionStorage.removeItem('qc_ctx'); } catch (_) {} // sidebar cache from js/dashboard.js
  window.location.href = '/auth/login.html';
}

// ─── Get current session ────────────────────────────────────────────────────
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// ─── Send password reset email ──────────────────────────────────────────────
export async function resetPassword(email, captchaToken) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password.html`,
    captchaToken,
  });
  if (error) throw error;
}

// ─── Update password (from reset link) ──────────────────────────────────────
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// ─── Plain-English auth errors (never show raw server text) ─────────────────
export function friendlyAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('captcha')) return 'Please complete the security check and try again.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Try signing in.';
  if (m.includes('invalid login')) return 'Incorrect email or password. Please try again.';
  if (m.includes('email not confirmed')) return 'Please confirm your email address first. Check your inbox.';
  if (m.includes('rate limit') || m.includes('too many') || err?.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('valid email') || m.includes('invalid email')) return 'Please enter a valid email address.';
  if (m.includes('different from the old')) return "Choose a password you haven't used before.";
  if (m.includes('password')) return 'Please choose a stronger password (at least 8 characters).';
  if (m.includes('failed to fetch') || m.includes('network')) return "Can't reach QuoteChase. Check your connection and try again.";
  return 'Something went wrong. Please try again.';
}
