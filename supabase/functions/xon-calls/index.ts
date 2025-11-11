import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the XON API key from environment
    const XON_API_KEY = Deno.env.get('XON')
    if (!XON_API_KEY) {
      throw new Error('XON API key not configured')
    }

    // Parse request body for optional filters
    const { limit = 5, account_scope, start_date, end_date } = await req.json().catch(() => ({}))

    // Build X-on API URL
    const baseUrl = 'https://platform.x-onweb.com/api/v1/calls'
    const params = new URLSearchParams()
    
    // Add filters if provided
    if (account_scope) params.append('account_scope', account_scope)
    if (start_date) params.append('start_date', start_date)
    if (end_date) params.append('end_date', end_date)

    const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl

    // Call X-on API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${XON_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('X-on API error:', response.status, errorText)
      throw new Error(`X-on API returned ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    // Limit results to requested number
    const limitedData = {
      ...data,
      data: (data.data || []).slice(0, limit)
    }

    return new Response(
      JSON.stringify(limitedData),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      },
    )
  } catch (error) {
    console.error('Error in xon-calls function:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Failed to fetch calls from X-on API'
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      },
    )
  }
})
