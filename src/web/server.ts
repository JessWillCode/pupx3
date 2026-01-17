import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import { google } from "googleapis";
import prisma from "../lib/db.js";

dotenv.config();

const app = express();
const port = process.env.WEB_PORT || 3000;

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

app.use(express.json());
app.use(express.static("public"));

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId?: string;
    twitchUserId?: string;
  }
}

// ==================== TWITCH OAUTH ====================

const TWITCH_CLIENT_ID = process.env.TWITCH_APP_CLIENT_ID!;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_APP_CLIENT_SECRET!;
const TWITCH_REDIRECT_URI =
  process.env.TWITCH_REDIRECT_URI ||
  `http://localhost:${port}/auth/twitch/callback`;
const TWITCH_SCOPES = [
  "user:read:email",
  "user:bot",
  "user:write:chat",
  "user:read:chat",
  "chat:read",
  "chat:edit",
];

app.get("/auth/twitch", (req, res) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(TWITCH_REDIRECT_URI)}&response_type=code&scope=${TWITCH_SCOPES.join("%20")}`;
  res.redirect(authUrl);
});

app.get("/auth/twitch/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    // Exchange code for token
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: code as string,
        grant_type: "authorization_code",
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error("No access token received");
    }

    // Get user info
    const userResponse = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-ID": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();
    const twitchUser = userData.data[0];

    // Store or update user in database
    const user = await prisma.user.upsert({
      where: { twitchUserId: twitchUser.id },
      create: {
        twitchUserId: twitchUser.id,
        twitchUsername: twitchUser.login,
        twitchAccessToken: tokenData.access_token,
        twitchRefreshToken: tokenData.refresh_token,
        twitchScopes: tokenData.scope,
        isActive: true,
      },
      update: {
        twitchUsername: twitchUser.login,
        twitchAccessToken: tokenData.access_token,
        twitchRefreshToken: tokenData.refresh_token,
        twitchScopes: tokenData.scope,
        isActive: true,
      },
    });

    // Store user ID in session
    req.session.userId = user.id;
    req.session.twitchUserId = user.twitchUserId;

    res.redirect("/dashboard");
  } catch (error) {
    console.error("Twitch OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

// ==================== GOOGLE OAUTH ====================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_APP_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_APP_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${port}/auth/google/callback`;
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/youtube"];

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

app.get("/auth/google", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send("Please login with Twitch first");
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;

  if (!code || !req.session.userId) {
    return res.status(400).send("Invalid request");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code as string);

    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send(
          "No refresh token received. Please try disconnecting and reconnecting.",
        );
    }

    // Update user with Google refresh token
    await prisma.user.update({
      where: { id: req.session.userId },
      data: {
        googleRefreshToken: tokens.refresh_token,
      },
    });

    res.redirect("/dashboard");
  } catch (error) {
    console.error("Google OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

// ==================== DASHBOARD API ====================

app.get("/api/user", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        twitchUsername: true,
        googleRefreshToken: true,
        youtubePlaylistId: true,
        playlistName: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      username: user.twitchUsername,
      hasYouTube: !!user.googleRefreshToken,
      playlistName: user.playlistName,
      isActive: user.isActive,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

app.post("/api/user/toggle", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updated = await prisma.user.update({
      where: { id: req.session.userId },
      data: { isActive: !user.isActive },
    });

    res.json({ isActive: updated.isActive });
  } catch (error) {
    console.error("Error toggling user:", error);
    res.status(500).json({ error: "Failed to toggle user" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true });
  });
});

// ==================== PAGES ====================

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>YouTube Music Song Request Bot</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0e0e10; color: #efeff1; }
        .container { max-width: 800px; margin: 0 auto; padding: 60px 20px; }
        h1 { font-size: 48px; margin-bottom: 20px; }
        p { font-size: 18px; color: #adadb8; margin-bottom: 30px; line-height: 1.6; }
        .btn { display: inline-block; background: #9147ff; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; }
        .btn:hover { background: #772ce8; }
        .features { margin-top: 60px; }
        .feature { margin-bottom: 30px; }
        .feature h3 { color: #efeff1; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎵 YouTube Music Song Requests</h1>
        <p>Add song requests to your stream with a simple Twitch bot. Viewers use <strong>!sr</strong> to request songs, and they're automatically added to your YouTube Music playlist.</p>
        <a href="/auth/twitch" class="btn">Connect with Twitch</a>
        
        <div class="features">
          <div class="feature">
            <h3>✨ Easy Setup</h3>
            <p>Connect your Twitch and YouTube accounts in under 2 minutes.</p>
          </div>
          <div class="feature">
            <h3>🎶 Smart Search</h3>
            <p>Searches YouTube Music to find the best match for viewer requests.</p>
          </div>
          <div class="feature">
            <h3>🔗 Direct Links</h3>
            <p>Viewers can also share YouTube or YouTube Music links directly.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dashboard - YouTube Music Bot</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0e0e10; color: #efeff1; }
        .container { max-width: 800px; margin: 0 auto; padding: 60px 20px; }
        h1 { font-size: 36px; margin-bottom: 30px; }
        .card { background: #18181b; padding: 30px; border-radius: 8px; margin-bottom: 20px; }
        .card h2 { margin-bottom: 15px; font-size: 24px; }
        .status { display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 14px; font-weight: 600; }
        .status.connected { background: #00f593; color: #000; }
        .status.disconnected { background: #eb0400; color: #fff; }
        .btn { display: inline-block; background: #9147ff; color: white; padding: 10px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; }
        .btn:hover { background: #772ce8; }
        .btn-secondary { background: #3a3a3d; }
        .btn-secondary:hover { background: #4c4c4f; }
        p { margin-bottom: 15px; color: #adadb8; }
        .commands { background: #1f1f23; padding: 20px; border-radius: 6px; margin-top: 15px; }
        .commands code { color: #00f593; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Dashboard</h1>
        
        <div class="card">
          <h2>Twitch</h2>
          <p><span class="status connected">✓ Connected</span></p>
          <p id="username">Loading...</p>
        </div>

        <div class="card">
          <h2>YouTube Music</h2>
          <p id="youtube-status"><span class="status disconnected">✗ Not Connected</span></p>
          <button id="connect-youtube" class="btn" style="display: none;">Connect YouTube</button>
          <p id="youtube-connected" style="display: none; color: #00f593;">✓ YouTube connected!</p>
        </div>

        <div class="card">
          <h2>Bot Status</h2>
          <p id="bot-status">Loading...</p>
          <button id="toggle-bot" class="btn-secondary btn">Loading...</button>
        </div>

        <div class="card">
          <h2>Commands</h2>
          <div class="commands">
            <p><code>!sr [song name or link]</code> - Request a song</p>
            <p><code>!np</code> - Show now playing</p>
            <p><code>!skip</code> - Skip current song</p>
          </div>
        </div>

        <button id="logout" class="btn btn-secondary" style="margin-top: 20px;">Logout</button>
      </div>

      <script>
        async function loadUser() {
          const res = await fetch('/api/user');
          const data = await res.json();
          
          document.getElementById('username').textContent = 'Channel: ' + data.username;
          
          if (data.hasYouTube) {
            document.getElementById('youtube-status').innerHTML = '<span class="status connected">✓ Connected</span>';
            document.getElementById('youtube-connected').style.display = 'block';
          } else {
            document.getElementById('connect-youtube').style.display = 'inline-block';
          }

          const statusText = data.isActive ? '🟢 Bot is active in your channel' : '⚫ Bot is disabled';
          document.getElementById('bot-status').textContent = statusText;
          
          const toggleBtn = document.getElementById('toggle-bot');
          toggleBtn.textContent = data.isActive ? 'Disable Bot' : 'Enable Bot';
          toggleBtn.onclick = async () => {
            await fetch('/api/user/toggle', { method: 'POST' });
            loadUser();
          };
        }

        document.getElementById('connect-youtube').onclick = () => {
          window.location.href = '/auth/google';
        };

        document.getElementById('logout').onclick = async () => {
          await fetch('/api/logout', { method: 'POST' });
          window.location.href = '/';
        };

        loadUser();
      </script>
    </body>
    </html>
  `);
});

// ==================== START SERVER ====================

app.listen(port, () => {
  console.log(`🌐 Web dashboard running on http://localhost:${port}`);
});
