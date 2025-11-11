# X-on Integration Setup

## Overview
The Call Centre page fetches the list of currently logged-in receptionists from X-on via a secure Supabase Edge Function.

## Architecture
- **Frontend**: `src/pages/CallCentre.jsx` polls the Supabase function every 10 seconds
- **Backend**: Supabase Edge Function `xon-proxy` reads the X-on API key from Edge Secret `XON` and calls X-on API
- **Security**: API key is stored server-side only, never exposed to client

## Configuration

### 1. Supabase Edge Secret (already done ✓)
The Edge Secret `XON` contains your X-on API key.

### 2. Environment Variables
File: `.env` (already created ✓)
```
VITE_XON_PROXY_URL=https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/xon-proxy
VITE_XON_GROUP_ID=0002
```

Update `VITE_XON_GROUP_ID` to match your receptionists' group ID in X-on.

### 3. Supabase Edge Function (already deployed ✓)
Function name: `xon-proxy`
Location: `supabase/functions/xon-proxy/index.ts`

## Testing

### Test the function directly
```bash
curl "https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/xon-proxy?groupId=0002"
```

Expected response:
```json
{
  "data": [
    {
      "id": "0003",
      "name": "John Doe",
      "active": true,
      "priority": 1,
      "numbers": { "work": "200010003", "mobile": "+447700900123" }
    }
  ]
}
```

### Test in the app
1. Start dev server: `npm run dev`
2. Open http://localhost:5174
3. Navigate to "Call Centre" page
4. The receptionist dropdown should populate with active users from X-on
5. Check browser console for any errors

## How It Works

1. **Page loads**: Call Centre component calls `fetchReceptionists()`
2. **Fetch**: Client sends GET to `https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/xon-proxy?groupId=0002`
3. **Function**: Supabase function reads `XON` secret, calls X-on API `GET /api/v1/groups/0002`
4. **Filter**: Function filters members where `active: true`
5. **Return**: Function returns `{ data: [...] }` to client
6. **Update**: Client populates dropdown with active receptionists
7. **Poll**: Repeat every 10 seconds to keep list fresh

## Troubleshooting

### Dropdown shows "Unable to load"
- Check browser Network tab for the request to your function
- Verify the function URL in `.env` is correct
- Test the function directly with curl

### Dropdown shows "No active receptionists"
- Verify users are logged in and active in X-on
- Check the group ID is correct in `.env`
- Test with curl to see raw response

### Function returns 500
- Verify the Edge Secret `XON` is set correctly
- Check Supabase function logs in dashboard

### Rate limiting
- X-on API has rate limits (check response headers)
- The function has a 5-second cache per edge instance
- Adjust polling interval if needed (currently 10s)

## Finding Your Group ID

To find your group ID in X-on:
1. Log into X-on Configuration Console
2. Navigate to Groups
3. Your group ID will be shown (e.g., G0002 → use 0002)

Or call the X-on API:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://platform.x-onweb.com/api/v1/groups
```

## Customization

### Change polling interval
Edit `src/pages/CallCentre.jsx`:
```js
pollRef.current = setInterval(fetchReceptionists, 30000); // 30 seconds
```

### Show all users (not just a group)
Modify the Supabase function to call `/api/v1/users` and filter by status instead of group membership.

### Add status indicators
The function already returns user fields. You can display status (AVAILABLE, BREAK, etc.) by accessing the X-on `/api/v1/users` endpoint instead.
