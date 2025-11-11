// supabase/functions/xon-queue-live/index.ts
// Fetch queued calls from X-on /api/v1/groups?includes=queue
// Configure secret `XON` in your Supabase project (Edge Functions -> Secrets)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS })
    }

    const XON_API_KEY = Deno.env.get('XON')
    if (!XON_API_KEY) {
      return new Response(JSON.stringify({ error: 'XON secret not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    // Parse optional query parameters
    const url = new URL(req.url)
    const matchParam = url.searchParams.get('match') || ''
    const matchNumbers = matchParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    // Fetch groups with queue info included
    const groupsUrl = 'https://platform.x-onweb.com/api/v1/groups?includes=queue'
    
    const r = await fetch(groupsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${XON_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return new Response(JSON.stringify({
        error: 'X-on API error',
        status: r.status,
        details: text
      }), {
        status: r.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const json = await r.json().catch(() => ({}))
    const groups = Array.isArray(json?.data) ? json.data : []

    // Collect groups with queued calls
    const queuedGroups = groups
      .filter(g => g?.queue?.data?.size && g.queue.data.size > 0)
      .map(g => ({
        group_id: g.id,
        group_name: g.name,
        queue_size: g.queue?.data?.size || 0,
        queue_oldest: g.queue?.data?.oldest || null,
        queue_max_wait: g.queue?.data?.max_wait || null,
        queue_max_size: g.queue?.data?.max_size || null
      }))

    const totalQueued = queuedGroups.reduce((sum, g) => sum + g.queue_size, 0)

    // Now fetch actual queued calls - the groups endpoint only gives us queue stats
    // We need to call /api/v1/calls with appropriate filters to get actual queued calls
    // According to X-on docs, we can filter calls, but there's no explicit "queued" status
    // The best approach is to look for calls in progress that haven't been answered yet
    
    // For now, return the queue summary from groups
    // If you need individual queued call phone numbers, you may need to use a different X-on endpoint
    // or poll /api/v1/calls with filters for ongoing calls

    return new Response(JSON.stringify({
      total_groups_checked: groups.length,
      groups_with_queue: queuedGroups.length,
      total_queued: totalQueued,
      queued_groups: queuedGroups,
      note: 'X-on /api/v1/groups provides queue size but not individual caller details. For phone numbers, use console.x-onweb.com live view or contact X-on for additional API endpoints.'
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('xon-queue-live error', err)
    return new Response(JSON.stringify({ error: 'Internal server error', message: err?.message || String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})
