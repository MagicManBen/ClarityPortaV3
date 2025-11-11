import { createClient } from '@supabase/supabase-js';

// ⚠️ SERVER-ONLY CLIENT - DO NOT IMPORT IN BROWSER/CLIENT CODE
// This uses the service_role key which bypasses Row Level Security
export const supabaseAdmin = createClient(
  'https://wwxnjelfqxueleeixesn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eG5qZWxmcXh1ZWxlZWl4ZXNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTU3NzcwOSwiZXhwIjoyMDc3MTUzNzA5fQ.lJZRG0ZeV0s3Ny2G-xDyo6APLjJjI7b3Hw_rr3HdtNI'
);
