import { supabase } from '/js/supabase.js';

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
// Each page calls trackVisit() explicitly — no auto-fire here