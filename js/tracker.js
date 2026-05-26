import { supabase } from './supabase.js';

export async function trackVisit(page) {
  try {
    await supabase.from('site_visits').insert({
      page: page || window.location.pathname,
      user_agent: navigator.userAgent,
    });
  } catch (_) {
    // Non-critical — never block the page
  }
}

// Auto-track on load
trackVisit(window.location.pathname);
