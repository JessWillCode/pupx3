# 🎵 YouTube Music Song Request Bot (Multi-User)

A Twitch bot that lets streamers and their viewers request songs through chat, automatically adding them to a YouTube Music playlist.

## ✨ Features

- **Multi-User Support**: One bot serves unlimited streamers
- **Easy Setup**: Streamers just connect Twitch + YouTube
- **Smart Search**: Finds best match on YouTube Music
- **Direct Links**: Supports YouTube and YouTube Music URLs
- **Mod Controls**: Skip command for mods/broadcaster
- **Auto-Playlist**: Creates and manages playlists automatically

## 🎮 Commands

- `!sr <song name or YouTube link>` - Request a song
- `!np` - Show what's currently playing
- `!skip` - Skip current song (mods/broadcaster only)

## 🚀 Quick Start (Development)

### Prerequisites
- Node.js 18+
- PostgreSQL database (or use Railway)
- Twitch application
- Google Cloud project with YouTube API

### Installation

1. Clone and install:
```bash
git clone 
cd 
npm install
```

2. Set up environment variables:
```bash
cp .env.multi.example .env
# Fill in your credentials
```

3. Initialize database:
```bash
npm run db:push
```

4. Start the web dashboard:
```bash
npm run web
```

5. Start the bot (in another terminal):
```bash
npm start
```

Visit http://localhost:3000 to connect your accounts!

## 📦 Project Structure

```
├── src/
│   ├── bot/
│   │   └── index.ts          # Multi-channel bot
│   ├── web/
│   │   └── server.ts         # OAuth & dashboard
│   └── lib/
│       ├── db.ts             # Prisma client
│       ├── google.ts         # YouTube Music API
│       └── commands.ts       # Command handler
├── prisma/
│   └── schema.prisma         # Database schema
└── package.json
```

## 🌐 Deployment

See [MULTI_USER_DEPLOYMENT.md](./MULTI_USER_DEPLOYMENT.md) for detailed deployment instructions.

### Quick Deploy to Railway

1. Create Twitch & Google OAuth apps
2. Create Railway project with PostgreSQL
3. Deploy web dashboard + bot as separate services
4. Set environment variables
5. Run `npm run db:push`
6. Visit your Railway URL!

## 🛠️ Development Commands

```bash
npm start          # Start bot
npm run dev        # Start bot with hot reload
npm run web        # Start web dashboard
npm run db:push    # Push schema changes to database
npm run db:studio  # Open Prisma Studio (database GUI)
```

## 🔒 Security

- Tokens are encrypted in database
- OAuth flows use secure redirects
- Sessions are secured with secrets
- Environment variables for sensitive data

## 📊 Database Schema

```prisma
model User {
  id                 String   @id @default(cuid())
  twitchUserId       String   @unique
  twitchUsername     String
  twitchAccessToken  String
  twitchRefreshToken String
  googleRefreshToken String?  // Nullable until connected
  youtubePlaylistId  String?
  playlistName       String   @default("Song Requests")
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

## 🐛 Troubleshooting

### Bot not joining channels
- Check database for active users
- Verify tokens are valid
- Check bot logs for errors

### Song requests failing
- Ensure YouTube connection is valid
- Check Google API quota
- Verify playlist permissions

### OAuth errors
- Verify redirect URIs match exactly
- Check client IDs/secrets
- Ensure APIs are enabled

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📝 License

MIT License - feel free to use for your own projects!

## 💡 Future Ideas

- Spotify support
- Song queue limits
- User analytics
- Custom commands
- Song voting system
- Blacklist/whitelist
- Multi-language support

## 🙏 Credits

Built with:
- [Twurple](https://twurple.js.org/) - Twitch API wrapper
- [Prisma](https://www.prisma.io/) - Database ORM
- [ytmusic-api](https://github.com/nickp10/youtube-music-api) - YouTube Music
- [Express](https://expressjs.com/) - Web framework

## 📧 Support

If you need help:
1. Check [MULTI_USER_DEPLOYMENT.md](./MULTI_USER_DEPLOYMENT.md)
2. Look at existing issues
3. Create a new issue with details

---

Made with ❤️ for the Twitch community