// Supabase Edge Function: xon-proxy
// Purpose: securely call X-on API using an edge secret named `XON` and return active members for a group.
// Usage (after deploying to Supabase Functions):
// GET https://<project>.functions.supabase.co/xon-proxy?groupId=0002

let cache: { ts: number; groupId: string; data: any } | null = null;
const CACHE_TTL_MS = 5000;

export default async function (req: Request) {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const XON_API_KEY = Deno.env.get('XON');
    if (!XON_API_KEY) {
      return new Response(JSON.stringify({ error: 'XON secret not configured' }), { 
        status: 500,
        headers: corsHeaders()
      });
    }

    // Check cache first
    if (cache && cache.ts && Date.now() - cache.ts < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ data: cache.data, cached: true }), {
        status: 200,
        headers: corsHeaders()
      });
    }

    // Fetch ALL users from X-on (paginated)
    const users: any[] = [];
    let pageUrl = `https://platform.x-onweb.com/api/v1/users?per_page=100`;

    while (pageUrl) {
      const r = await fetch(pageUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${XON_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return new Response(JSON.stringify({ error: `X-on API error: ${r.status}`, details: text }), { 
          status: r.status, 
          headers: corsHeaders() 
        });
      }

      const pageJson = await r.json();
      const pageData = (pageJson && pageJson.data && Array.isArray(pageJson.data)) ? pageJson.data : [];
      users.push(...pageData);

      // Follow pagination next link if provided
      const next = pageJson?.meta?.pagination?.links?.next;
      if (next) {
        pageUrl = next;
      } else {
        break;
      }
    }

    // Filter: return anyone whose status is NOT LOGGED_OUT
    const active = users
      .filter((u: any) => u?.status && u.status !== 'LOGGED_OUT')
      .map((u: any) => ({ 
        id: u.id, 
        name: u.name || u.email || 'Unknown', 
        status: u.status,
        email: u.email,
        numbers: u.numbers,
        active_number: u.active_number
      }));

    // Update cache
    cache = { ts: Date.now(), groupId: 'ALL', data: active };

    return new Response(JSON.stringify({ 
      data: active,
      total_users_fetched: users.length,
      active_users: active.length 
    }), {
      status: 200,
      headers: corsHeaders()
    });
  } catch (err) {
    console.error('xon-proxy error', err);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: err?.message || String(err)
    }), { 
      status: 500, 
      headers: corsHeaders() 
    });
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
