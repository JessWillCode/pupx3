# Multi-User Bot Deployment Guide

## Overview
This setup allows multiple streamers to use your bot. Each streamer connects their own Twitch and YouTube accounts through a web dashboard.

## Architecture
- **Web Dashboard**: Handles OAuth and user management
- **Bot**: Connects to all active users' channels
- **Database**: Stores user credentials and settings

## Step 1: Set Up Your Apps

### 1.1 Create Twitch Application
1. Go to https://dev.twitch.tv/console/apps
2. Create a new application
3. Set OAuth Redirect URL: `http://localhost:3000/auth/twitch/callback` (we'll update this for production)
4. Copy your **Client ID** and **Client Secret**

### 1.2 Create Google Cloud Project
1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable **YouTube Data API v3**
4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
5. Choose "Web application"
6. Add Authorized redirect URI: `http://localhost:3000/auth/google/callback`
7. Copy your **Client ID** and **Client Secret**

## Step 2: Set Up Database on Railway

1. Go to https://railway.app
2. Create a new project
3. Click "Add Service" → "Database" → "PostgreSQL"
4. Copy the **DATABASE_URL** from the "Variables" tab

## Step 3: Local Setup

### 3.1 Install Dependencies
```bash
npm install
```

### 3.2 Configure Environment
Copy `.env.multi.example` to `.env` and fill in your values:
```env
DATABASE_URL=postgresql://...
TWITCH_APP_CLIENT_ID=your_id
TWITCH_APP_CLIENT_SECRET=your_secret
GOOGLE_APP_CLIENT_ID=your_id
GOOGLE_APP_CLIENT_SECRET=your_secret
```

### 3.3 Initialize Database
```bash
npm run db:push
```

This creates the `User` table in your database.

### 3.4 Start the Web Server
```bash
npm run web
```

Visit http://localhost:3000 and test the OAuth flow!

### 3.5 Start the Bot (in a separate terminal)
```bash
npm start
```

## Step 4: Deploy to Railway

### 4.1 Update OAuth Redirect URIs

After deploying, you'll get a Railway URL like `https://your-app.railway.app`

Update your redirect URIs:

**Twitch App:**
- Add: `https://your-app.railway.app/auth/twitch/callback`

**Google App:**
- Add: `https://your-app.railway.app/auth/google/callback`

### 4.2 Push to GitHub

Create `.gitignore`:
```
node_modules/
.env
*.log
prisma/migrations/
```

Push your code:
```bash
git init
git add .
git commit -m "Multi-user bot"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 4.3 Deploy Web Dashboard to Railway

1. In Railway, click "New" → "Deploy from GitHub"
2. Select your repository
3. Add environment variables:
   - Copy all from your `.env` file
   - Update `TWITCH_REDIRECT_URI` to use your Railway URL
   - Update `GOOGLE_REDIRECT_URI` to use your Railway URL
   - Set `SESSION_SECRET` to a random string
   - Set `NODE_ENV=production`
4. In "Settings" → "Start Command": `npm run web`
5. In "Settings" → "Public Domain": Enable to get a URL

### 4.4 Deploy Bot to Railway

1. Create another service in the same project
2. Select the same GitHub repository
3. Add the SAME environment variables
4. In "Settings" → "Start Command": `npm start`
5. This service doesn't need a public domain

### 4.5 Run Database Migration

In the Railway dashboard for your bot service:
1. Go to "Settings" → "Commands"
2. Run: `npm run db:push`

## Step 5: Test Everything

1. Visit your Railway web URL
2. Click "Connect with Twitch"
3. Authorize your Twitch account
4. Click "Connect YouTube"
5. Authorize your Google account
6. Check the bot logs in Railway - it should join your channel!
7. Go to your Twitch channel and test: `!sr never gonna give you up`

## How Users Will Use It

1. Visit your website
2. Click "Connect with Twitch"
3. Click "Connect YouTube"
4. Done! The bot automatically joins their channel

## Monitoring

### View Logs
Railway dashboard → Your service → "Logs" tab

### Database Management
```bash
npm run db:studio
```
Opens Prisma Studio to view/edit database records

### Check Active Users
View the bot logs to see which channels it's connected to

## Commands

Users can use these commands in their Twitch chat:

- `!sr <song name or link>` - Request a song
- `!np` - Show now playing
- `!skip` - Skip current song (mods only)

## Troubleshooting

### "No active users found"
- Make sure users have connected both Twitch AND YouTube
- Check the database to see if users exist

### "YouTube Music is not connected"
- User needs to connect YouTube from the dashboard
- Check `googleRefreshToken` is not null in database

### Bot not joining channels
- Check bot logs for errors
- Verify `isActive` is true in database
- Make sure bot polls for new users (every 5 minutes)

### OAuth errors
- Verify redirect URIs match exactly (including http vs https)
- Check client IDs and secrets are correct
- Make sure APIs are enabled in Google Cloud Console

## Security Notes

- Never commit `.env` to git
- Use strong `SESSION_SECRET` in production
- Tokens are stored in database - keep DATABASE_URL secret
- Consider encrypting sensitive fields in production

## Costs

- Railway: ~$15-20/month (database + 2 services)
- Everything else is free!

## Scaling

Current setup handles ~100 users easily. For more:
- Add Redis for session storage
- Implement rate limiting
- Add monitoring/alerting
- Consider horizontal scaling

## Future Enhancements

- [ ] Custom playlist names
- [ ] Song queue limits
- [ ] User analytics dashboard
- [ ] Admin panel
- [ ] Spotify support
- [ ] Custom commands
- [ ] Song history
- [ ] Blacklist feature