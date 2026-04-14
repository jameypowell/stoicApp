# Quick Start - User Workout Viewing

## 🚀 How to Use

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open your browser:**
   ```
   http://localhost:3000
   ```

3. **User Flow:**
   - **Register** → Create account with email/password
   - **Login** → Access your account
   - **Purchase Subscription** → Choose Daily ($2.99), Weekly ($9.99), or Monthly ($29.99)
   - **View Workouts** → Browse available workouts based on your subscription
   - **Read Workout** → Click any workout card to see full content

## 📱 What Users See

### Initial Screen (Not Logged In)
- Login/Register tabs
- Clean authentication form

### After Login
- **Subscription Status Card**: Shows active subscription or purchase options
- **Workouts List**: Grid of available workout cards (based on subscription)
- **Navigation Bar**: User email and logout button

### Workout Cards
- Click any card to view full workout content
- Shows workout date formatted nicely
- Displays workout title

### Payment Flow
- Choose subscription tier
- Stripe payment form appears
- Enter test card: `4242 4242 4242 4242`
- Complete payment to activate subscription

## 🎨 Features

✅ **Responsive Design** - Works on mobile, tablet, desktop
✅ **Modern UI** - Beautiful gradient background, card-based layout
✅ **Secure Auth** - JWT tokens, password hashing
✅ **Stripe Integration** - Secure payment processing
✅ **Access Control** - Workouts filtered by subscription tier
✅ **Persistent Sessions** - Stays logged in after refresh

## 🧪 Testing

### Test Cards (Stripe Test Mode)
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- Any future expiry, any CVC, any ZIP

### Test Flow
1. Register: `test@example.com` / `password123`
2. Login with same credentials
3. Purchase "Daily" tier ($2.99)
4. Use test card: `4242 4242 4242 4242`
5. View today's workout (if available)

## 📁 Files Created

- `public/index.html` - Main page structure
- `public/styles.css` - All styling
- `public/app.js` - Frontend logic

## 🔧 Troubleshooting

**Can't see workouts?**
- Make sure you have an active subscription
- Check that workouts exist in the database for your subscription date range
- Verify subscription tier matches workout access requirements

**Payment not working?**
- Check `STRIPE_PUBLISHABLE_KEY` is set in `.env`
- Verify it's a test key (starts with `pk_test_`)
- Check browser console for errors

**Not staying logged in?**
- Check browser localStorage is enabled
- Clear localStorage and try again

## 🎯 What's Next?

Your users can now:
1. ✅ Register and login
2. ✅ Purchase subscriptions
3. ✅ View workout lists
4. ✅ Read workout content

Future enhancements you might want:
- Search/filter workouts
- Favorite workouts
- Workout history
- Email notifications
- Profile settings
- Subscription management (cancel, upgrade)

