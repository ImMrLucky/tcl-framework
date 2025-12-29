# Authentication Setup Guide

## Overview

The ProtectQA app now includes full authentication with Supabase:
- Sign up / Sign in with email and password
- User profile management
- Onboarding flow for new users
- Protected routes (optional)

## What Was Added

### 1. Auth Service (`src/app/auth.service.ts`)
- Handles Supabase authentication
- Manages user session state
- Provides methods for sign up, sign in, sign out
- Updates user profile

### 2. Login Component (`src/app/auth/login.component.ts`)
- Sign up / Sign in form
- Email and password validation
- Toggle between sign up and sign in modes
- Redirects to onboarding if profile incomplete

### 3. Onboarding Component (`src/app/auth/onboarding.component.ts`)
- Collects user profile information:
  - Company Role/Title (input)
  - Company Industry (dropdown)
  - How calls operate (dropdown: Inbound, Outbound, Both)
  - Primary Use Case (dropdown)

### 4. Updated Routes
- `/login` - Login/Sign up page
- `/onboarding` - Profile completion page
- Existing routes remain accessible

### 5. Updated Header
- Shows "Sign In" button when not authenticated
- Shows user menu with profile info when authenticated
- User menu includes:
  - Profile Settings (links to onboarding)
  - Sign Out

## Database Schema Update

The `profiles` table now includes:
- `company_role` (text)
- `company_industry` (text)
- `call_operation` (text)
- `primary_use_case` (text)

**Important:** Run the updated SQL migration in Supabase:
```sql
-- Add new columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS company_role text,
ADD COLUMN IF NOT EXISTS company_industry text,
ADD COLUMN IF NOT EXISTS call_operation text,
ADD COLUMN IF NOT EXISTS primary_use_case text;
```

## Configuration

The auth service is configured with your Supabase credentials:
- URL: `https://uqwcmkyaskyduxuluqrm.supabase.co`
- Anon Key: (from your .env)

To change these, edit `src/app/auth.service.ts`:
```typescript
const supabaseUrl = 'your-url';
const supabaseAnonKey = 'your-key';
```

Or better: use environment variables (see next section).

## Environment Variables (Recommended)

Create `src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  supabaseUrl: 'https://uqwcmkyaskyduxuluqrm.supabase.co',
  supabaseAnonKey: 'your-anon-key'
};
```

Then update `auth.service.ts` to use:
```typescript
import { environment } from '../environments/environment';
const supabaseUrl = environment.supabaseUrl;
const supabaseAnonKey = environment.supabaseAnonKey;
```

## Testing

1. Start the UI:
   ```bash
   cd packages/tcl-ui
   npm start
   ```

2. Navigate to `/login` or click "Sign In" in the header

3. Sign up with a new account:
   - Email: `test@example.com`
   - Password: `password123`

4. After signup, you'll be redirected to `/onboarding`

5. Fill in your profile details

6. You'll be redirected to the main app

## Next Steps

- [ ] Add auth guards to protect routes (optional)
- [ ] Add password reset functionality
- [ ] Add email verification
- [ ] Store user preferences
- [ ] Add user dashboard

