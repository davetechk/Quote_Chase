import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://bqqyiawsawnoikyvoxfj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxcXlpYXdzYXdub2lreXZveGZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2ODUzNjksImV4cCI6MjA5NTI2MTM2OX0.7hiXht4pqj-pjXAVUp47965KgjIf9SNqx4_MFmytCCI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
