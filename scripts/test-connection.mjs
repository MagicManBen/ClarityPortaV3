import { supabase, SUPABASE_URL } from '../src/lib/supabaseClient.js';

(async () => {
  console.log('🔍 Testing connection to Supabase...');
  console.log('📍 Connected to:', SUPABASE_URL);
  console.log('');

  try {
    // Try a simple query to test the connection
    const { data, error } = await supabase
      .from('pg_tables')
      .select('*')
      .limit(1);

    if (error) {
      console.log('⚠️  Query error (expected if pg_tables is not accessible):', error.message);
    } else {
      console.log('✅ Connection successful!');
      console.log('📊 Sample data:', data || []);
    }

    // Alternative: Try to list tables the client has access to
    const { data: tables, error: tablesError } = await supabase
      .rpc('get_tables')
      .limit(1);
    
    if (!tablesError) {
      console.log('📋 Accessible tables:', tables);
    }

  } catch (e) {
    console.error('❌ Unexpected error:', e.message);
    process.exit(1);
  }

  console.log('');
  console.log('✅ Health check complete!');
})();
