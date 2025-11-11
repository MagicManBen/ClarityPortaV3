# Deploy X-on Proxy Function

## What Changed
The Edge Function now fetches **ALL users** from X-on (not group-based) and returns anyone whose status is NOT `LOGGED_OUT`.

## Deploy Steps

1. **Make sure you're logged in to Supabase CLI:**
   ```bash
   supabase login
   ```

2. **Link to your project (if not already linked):**
   ```bash
   supabase link --project-ref wwxnjelfqxueleeixesn
   ```

3. **Deploy the updated function:**
   ```bash
   supabase functions deploy xon-proxy
   ```

4. **Verify the secret exists:**
   ```bash
   supabase secrets list
   ```
   
   You should see `XON` in the list. If not, set it:
   ```bash
   supabase secrets set XON=your_xon_api_key_here
   ```

## Testing

After deployment, test the function directly:

```bash
curl "https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/xon-proxy"
```

Expected response:
```json
{
  "data": [
    {
      "id": "0003",
      "name": "Ben Howard",
      "status": "AVAILABLE",
      "email": "...",
      "numbers": {...},
      "active_number": {...}
    },
    ...
  ],
  "total_users_fetched": 50,
  "active_users": 45
}
```

## Frontend Testing

1. Restart the Vite dev server (if `.env` changed):
   ```bash
   npm run dev
   ```

2. Open the Call Centre page and click the **Debug** button

3. Check the logs to see:
   - `fetch_success` with `total_users_fetched` and `active_users`
   - List of returned users in the receptionists dropdown

## Troubleshooting

- If you get empty results (`"data": []`), check:
  - Are there actually users logged in to X-on right now?
  - Check X-on dashboard to see user statuses
  - Try testing the X-on API directly with your API key

- If you get a 500 error:
  - Check function logs: `supabase functions logs xon-proxy`
  - Verify the XON secret is set correctly
  - Check that your X-on API key has the right permissions
