# Deploy X-on Calls Edge Function

This guide explains how to deploy the `xon-calls` Edge Function to Supabase to enable fetching ended calls from the X-on API.

## Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- X-on API key stored in Supabase Edge Secrets as `XON`
- Project linked to Supabase

## Steps to Deploy

### 1. Verify X-on API Key Secret

The API key should already be stored in your Supabase Edge Secrets. You can verify via the Supabase Dashboard:

1. Go to **Edge Functions** → **Secrets**
2. Confirm `XON` secret exists with your X-on API key

If not set, add it:

```bash
supabase secrets set XON=your_xon_api_key_here
```

### 2. Deploy the Edge Function

From your project root directory:

```bash
supabase functions deploy xon-calls
```

### 3. Verify Deployment

Test the function after deployment:

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/xon-calls' \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

Replace:
- `YOUR_PROJECT_REF` with your Supabase project reference
- `YOUR_ANON_KEY` with your Supabase anon key

### 4. Configure Environment Variables

Ensure your `.env` file has the Supabase URL and anon key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

## Function Details

### Endpoint
`POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/xon-calls`

### Request Body (Optional Parameters)
```json
{
  "limit": 5,
  "account_scope": "G0002",
  "start_date": "2025-11-01",
  "end_date": "2025-11-05"
}
```

### Response
```json
{
  "data": [
    {
      "id": 12345678,
      "direction": "INBOUND",
      "outcome": "CALLER_CLEAR",
      "start_time": "2025-11-05T10:30:00+00:00",
      "end_time": "2025-11-05T10:35:23+00:00",
      "caller": {
        "number": "01234567890"
      },
      "dialled": {
        "number": "03333320000"
      },
      "agent": {
        "name": "John Doe"
      },
      "type": "GROUP"
    }
  ],
  "meta": {
    "pagination": {
      "total": 150,
      "count": 5,
      "per_page": 15,
      "current_page": 1,
      "total_pages": 10
    }
  }
}
```

## How It Works

1. User clicks "Duty Dr Query" button in Call Centre
2. Modal opens and automatically triggers `fetchXonCalls()`
3. Function calls the Edge Function at `/functions/v1/xon-calls`
4. Edge Function retrieves X-on API key from secrets
5. Edge Function calls X-on API: `GET https://platform.x-onweb.com/api/v1/calls`
6. Results are limited to 5 most recent ended calls
7. Data is displayed in the modal

## X-on API Documentation

The function uses the X-on Call List API:
- **Endpoint**: `GET /api/v1/calls`
- **Documentation**: https://platform.x-onweb.com
- **Authentication**: Bearer token (API key from secrets)
- **Default behavior**: Returns last 24 hours of calls, ordered by end time descending

## Troubleshooting

### Function returns 401 Unauthorized
- Check that the `XON` secret is set correctly
- Verify the API key is valid in X-on platform

### Function returns 500 error
- Check Edge Function logs: `supabase functions logs xon-calls`
- Verify X-on API is accessible from Supabase edge network

### No calls displayed
- Check browser console for errors
- Use Debug panel in Call Centre to see API responses
- Verify X-on account has recent call history

## Debug Mode

The Call Centre includes a debug panel. Click the "Debug" button to see:
- `xon_calls_fetch_start` - When fetch begins
- `xon_calls_fetched` - Successful fetch with count and sample
- `xon_calls_error` - Any errors from the API
- `xon_calls_exception` - Client-side exceptions

## Security Notes

- The X-on API key is stored securely in Supabase Edge Secrets (never exposed to client)
- Edge Function acts as a secure proxy
- Client only receives call data, never the API key
- CORS headers are configured to allow requests from your domain
