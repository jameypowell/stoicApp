# Loading Functional Fitness Workouts to Production

This is the standard process for adding or updating functional fitness workouts. It uses the **in-app Admin** and requires no local scripts or database credentials.

## Steps

1. **Log in** to the app as an admin user at your production URL (e.g. https://app.stoic-fit.com).

2. **Open Admin → Workouts**  
   Go to the dashboard, open **Admin Console**, then click the **Workouts** tab.

3. **Use “Load Functional Fitness Workout”**  
   At the top you’ll see:
   - **Workout Date** – Pick the date this workout is for (e.g. tomorrow).
   - **Carousel Subheader** – Optional. Shown on the workout tile (e.g. “Lower Body — Squat Dominant”).
   - **Workout Content** – Paste the full workout text.

4. **Formatting tips for content**
   - Section headers that **end with a colon** (e.g. `Core Conditioning – 5 minutes:`) are shown **bold and underlined**.
   - “Warm Up – 5 minutes” (no colon) is also treated as a section header.
   - Use plain text; line breaks are preserved.

5. **Click “Save to Production”**  
   The workout is written to the **production database** immediately. No deploy or extra step.

## Summary

- **Where:** Admin Console → Workouts → “Load Functional Fitness Workout”.
- **What you need:** Admin login only (no DB credentials, no scripts).
- **Result:** Workout is live for that date; carousel shows the subheader if you set it.

## Optional: Set date to tomorrow

Before pasting content, set **Workout Date** to tomorrow’s date so the new workout appears as “tomorrow” in the app.

## API (for automation)

If you want to script this later, you can call the API with an admin JWT:

- **POST** `/api/admin/workouts/functional-fitness`
- **Headers:** `Authorization: Bearer <admin_jwt>`, `Content-Type: application/json`
- **Body:** `{ "date": "YYYY-MM-DD", "content": "...", "focus_areas": "Optional subheader" }`

Only admin users can call this endpoint.
