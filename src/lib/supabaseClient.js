import { createClient } from '@supabase/supabase-js';

// TODO: Move these to environment variables in production
// For now, hardcoded for the new Supabase project (all tables are empty)
export const SUPABASE_URL = 'https://wwxnjelfqxueleeixesn.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eG5qZWxmcXh1ZWxlZWl4ZXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1Nzc3MDksImV4cCI6MjA3NzE1MzcwOX0.oLmLQY8oGhMS-TqpnQBMh6Vnc8yjJqSOxH3mVMSuh5o';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
