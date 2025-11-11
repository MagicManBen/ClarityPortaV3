import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get API keys from environment
    const OPENAI_API_KEY = Deno.env.get('CHATGPT')
    const XON_API_KEY = Deno.env.get('XON')
    
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!XON_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'X-on API key not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { callId } = await req.json()
    
    if (!callId) {
      return new Response(
        JSON.stringify({ error: 'callId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Processing call:', callId)

    // Step 1: Get call audio URL from X-on API
    const audioListUrl = `https://platform.x-onweb.com/api/v1/calls/${callId}/audio`
    const audioListResponse = await fetch(audioListUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${XON_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    if (!audioListResponse.ok) {
      const errorText = await audioListResponse.text()
      console.error('X-on audio list error:', audioListResponse.status, errorText)
      return new Response(
        JSON.stringify({ 
          error: `Failed to get audio list: ${audioListResponse.status}`,
          details: errorText 
        }),
        { status: audioListResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const audioListData = await audioListResponse.json();
    console.log('Audio list response:', JSON.stringify(audioListData));

    // Extract the audio URL from the response
    // The X-on API returns: { data: [{ type: "RECORDING", links: [...], ... }] }
    if (!audioListData.data || audioListData.data.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No audio files found for this call',
          details: 'The recording may still be processing'
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Find the first RECORDING type audio file
    const firstRecording = audioListData.data.find((audio: any) => 
      String(audio.type || '').toUpperCase().includes('RECORDING')
    );

    if (!firstRecording) {
      return new Response(
        JSON.stringify({ 
          error: 'No recording found for this call',
          details: 'The call may only have voicemail or other audio types'
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract the URL from the links array (rel === 'self')
    const audioUrl = firstRecording.links?.find((link: any) => link.rel === 'self')?.uri;

    if (!audioUrl) {
      return new Response(
        JSON.stringify({ 
          error: 'No audio URL found in recording data',
          details: 'The recording links may be malformed or missing'
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('Audio URL:', audioUrl);

    // Step 2: Download the audio file from X-on
    const audioFileResponse = await fetch(audioUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${XON_API_KEY}`,
      },
    })

    if (!audioFileResponse.ok) {
      console.error('Failed to download audio:', audioFileResponse.status)
      return new Response(
        JSON.stringify({ error: 'Failed to download audio file' }),
        { status: audioFileResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const audioBlob = await audioFileResponse.blob()
    console.log('Audio downloaded, size:', audioBlob.size)

    // Step 3: Transcribe audio using OpenAI Whisper
    const whisperFormData = new FormData()
    whisperFormData.append('file', audioBlob, 'audio.mp3')
    whisperFormData.append('model', 'whisper-1')

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: whisperFormData,
    })

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text()
      console.error('Whisper API error:', whisperResponse.status, errorText)
      return new Response(
        JSON.stringify({ 
          error: `Whisper transcription failed: ${whisperResponse.status}`,
          details: errorText 
        }),
        { status: whisperResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const transcription = await whisperResponse.json()
    const transcriptText = transcription.text
    console.log('Transcription completed, length:', transcriptText.length)

    // Step 4: Generate duty doctor query using GPT-4o-mini
    const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a medical administrative assistant helping to create clear, professional duty doctor queries based on call transcripts. 

Your task is to:
1. Analyze the call transcript between a receptionist/agent and a patient
2. Extract the key medical concern or question that needs the duty doctor's attention
3. Write a concise, professional query for the duty doctor that includes:
   - The main medical concern/symptom
   - Relevant duration/severity
   - Any important context or patient concerns
   - What action is needed (callback, advice, prescription, etc.)

Format the query as a clear, professional message. Do NOT include patient contact details or EMIS numbers - the doctor can see those. Keep it factual and clinical. Be concise but include all medically relevant details.`
          },
          {
            role: 'user',
            content: `Based on this call transcript, generate a duty doctor query:\n\n${transcriptText}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    })

    if (!gptResponse.ok) {
      const errorText = await gptResponse.text()
      console.error('GPT API error:', gptResponse.status, errorText)
      return new Response(
        JSON.stringify({ 
          error: `GPT generation failed: ${gptResponse.status}`,
          details: errorText 
        }),
        { status: gptResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const gptResult = await gptResponse.json()
    const generatedQuery = gptResult.choices[0].message.content
    console.log('Query generated successfully')

    // Return the results
    return new Response(
      JSON.stringify({
        success: true,
        transcript: transcriptText,
        dutyQuery: generatedQuery,
        callId: callId
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        status: 200
      },
    )
  } catch (error: unknown) {
    console.error('Error in generate-duty-query function:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Failed to generate duty doctor query'
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
