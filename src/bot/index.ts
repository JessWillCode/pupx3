import * as dotenv from 'dotenv';
import chalk from 'chalk';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { Commands } from '../lib/commands.js';
import Google from '../lib/google.js';
import prisma from '../lib/db.js';

dotenv.config();

// Store Google instances per user
const googleInstances = new Map<string, Google>();

async function getGoogleForUser(userId: string): Promise<Google | null> {
  if (googleInstances.has(userId)) {
    return googleInstances.get(userId)!;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user?.googleRefreshToken) {
    return null;
  }

  const google = new Google({
    clientId: process.env.GOOGLE_APP_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_APP_CLIENT_SECRET!,
    refreshToken: user.googleRefreshToken,
    requestsPlaylistName: user.playlistName,
  });

  await google.initialize();
  googleInstances.set(userId, google);

  return google;
}

// YouTube URL patterns
const YT_WATCH_RE = /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/i;
const YT_SHORT_RE = /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:\?|$)/i;
const YT_MUSIC_RE = /(?:https?:\/\/)?music\.youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/i;

function extractYouTubeVideoId(text: string): string | null {
  return (
    text.match(YT_WATCH_RE)?.[1] ||
    text.match(YT_SHORT_RE)?.[1] ||
    text.match(YT_MUSIC_RE)?.[1] ||
    null
  );
}

async function main() {
  console.log(chalk.cyan('🤖 Starting multi-channel bot...'));

  // Load all active users from database
  const users = await prisma.user.findMany({
    where: { isActive: true },
  });

  if (users.length === 0) {
    console.log(chalk.yellow('⚠ No active users found. Waiting for users to connect...'));
  } else {
    console.log(chalk.green(`✓ Found ${users.length} active user(s)`));
  }

  // Set up Twitch auth provider
  const authProvider = new RefreshingAuthProvider({
    clientId: process.env.TWITCH_APP_CLIENT_ID!,
    clientSecret: process.env.TWITCH_APP_CLIENT_SECRET!,
  });

  // Add all users to auth provider
  for (const user of users) {
    try {
      await authProvider.addUser(user.twitchUserId, {
        accessToken: user.twitchAccessToken,
        refreshToken: user.twitchRefreshToken,
        expiresIn: 0,
        obtainmentTimestamp: 0,
      }, ['chat']);

      console.log(chalk.green(`✓ Added user: ${user.twitchUsername}`));
    } catch (error) {
      console.error(chalk.red(`✗ Failed to add user ${user.twitchUsername}:`), error);
    }
  }

  // Handle token refresh
  authProvider.onRefresh(async (userId, token) => {
    console.log(chalk.blue(`🔄 Refreshing token for user: ${userId}`));
    
    await prisma.user.update({
      where: { twitchUserId: userId },
      data: {
        twitchAccessToken: token.accessToken,
        twitchRefreshToken: token.refreshToken!,
      },
    });
  });

  // Create chat client with all channels
  const channels = users.map(u => u.twitchUsername);
  const chatClient = new ChatClient({ 
    authProvider, 
    channels,
    isAlwaysMod: true,
  });

  await chatClient.connect();

  console.log(chalk.yellow('##################################################'));
  console.log(chalk.yellow.bold(`🎵 Connected to ${channels.length} channel(s)`));
  channels.forEach(ch => console.log(chalk.yellow(`   - ${ch}`)));
  console.log(chalk.yellow('##################################################\n'));

  // Handle messages
  chatClient.onMessage(async (channel, user, text, msg) => {
    const channelName = channel.replace('#', '');
    
    console.log(
      chalk.greenBright('channel:'), channelName,
      chalk.greenBright('user:'), user,
      chalk.greenBright('message:'), text
    );

    // Find the user in database
    const dbUser = await prisma.user.findFirst({
      where: { twitchUsername: channelName },
    });

    if (!dbUser) {
      console.log(chalk.red(`User ${channelName} not found in database`));
      return;
    }

    // Handle !sr command
    if (text.toLowerCase().startsWith('!sr ')) {
      const query = text.slice(4).trim();

      if (!query) {
        await chatClient.say(channel, 'Please provide a song name or YouTube link!');
        return;
      }

      try {
        const google = await getGoogleForUser(dbUser.id);

        if (!google) {
          await chatClient.say(channel, 'YouTube Music is not connected. Please visit the dashboard to connect!');
          return;
        }

        // If it's a YouTube link, add directly
        const videoId = extractYouTubeVideoId(query);
        if (videoId) {
          const playlistId = dbUser.youtubePlaylistId || (await google.ensurePlaylist(dbUser.playlistName));
          
          // Update playlist ID in database if it was just created
          if (!dbUser.youtubePlaylistId) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { youtubePlaylistId: playlistId },
            });
          }

          await google.addToPlaylist(playlistId, videoId);
          await chatClient.say(channel, `✓ Added to queue: https://youtu.be/${videoId}`);
          return;
        }

        // Search YouTube Music
        const best = await google.searchBestMatch(query);
        if (!best) {
          await chatClient.say(channel, `No results found for "${query}"`);
          return;
        }

        const playlistId = dbUser.youtubePlaylistId || (await google.ensurePlaylist(dbUser.playlistName));
        
        // Update playlist ID in database if it was just created
        if (!dbUser.youtubePlaylistId) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { youtubePlaylistId: playlistId },
          });
        }

        await google.addToPlaylist(playlistId, best.videoId);
        await chatClient.say(channel, `✓ Added: ${best.title} — ${best.artists.join(', ')}`);

      } catch (error: any) {
        console.error('Song request error:', error);
        await chatClient.say(channel, 'Sorry, something went wrong with your request!');
      }
    }

    // Handle !np command
    if (text.toLowerCase() === '!np') {
      try {
        const google = await getGoogleForUser(dbUser.id);

        if (!google || !dbUser.youtubePlaylistId) {
          await chatClient.say(channel, 'No playlist found!');
          return;
        }

        const nowPlaying = await google.nowPlaying(dbUser.youtubePlaylistId);

        if (!nowPlaying) {
          await chatClient.say(channel, 'Nothing is playing right now!');
          return;
        }

        await chatClient.say(channel, `♪ Now Playing: ${nowPlaying.title} by ${nowPlaying.channel}`);
      } catch (error) {
        console.error('Now playing error:', error);
        await chatClient.say(channel, 'Could not fetch currently playing song.');
      }
    }

    // Handle !skip command
    if (text.toLowerCase() === '!skip') {
      // Check if user is mod or broadcaster
      if (!msg.userInfo.isMod && !msg.userInfo.isBroadcaster) {
        return;
      }

      try {
        const google = await getGoogleForUser(dbUser.id);

        if (!google || !dbUser.youtubePlaylistId) {
          await chatClient.say(channel, 'No playlist found!');
          return;
        }

        const skipped = await google.skipFirst(dbUser.youtubePlaylistId);

        if (skipped) {
          await chatClient.say(channel, '⏭ Skipped!');
        } else {
          await chatClient.say(channel, 'Queue is empty!');
        }
      } catch (error) {
        console.error('Skip error:', error);
        await chatClient.say(channel, 'Could not skip song.');
      }
    }
  });

  // Watch for new users every 5 minutes
  setInterval(async () => {
    console.log(chalk.blue('🔍 Checking for new users...'));
    
    const currentUsers = await prisma.user.findMany({
      where: { isActive: true },
    });

    for (const user of currentUsers) {
      // Check if we're already connected to this channel
      if (!channels.includes(user.twitchUsername)) {
        try {
          await authProvider.addUser(user.twitchUserId, {
            accessToken: user.twitchAccessToken,
            refreshToken: user.twitchRefreshToken,
            expiresIn: 0,
            obtainmentTimestamp: 0,
          }, ['chat']);

          await chatClient.join(user.twitchUsername);
          channels.push(user.twitchUsername);
          
          console.log(chalk.green(`✓ Added new channel: ${user.twitchUsername}`));
        } catch (error) {
          console.error(chalk.red(`✗ Failed to add channel ${user.twitchUsername}:`), error);
        }
      }
    }

    // Remove channels for inactive users
    for (const channel of channels) {
      const user = currentUsers.find(u => u.twitchUsername === channel);
      if (!user) {
        await chatClient.part(channel);
        const index = channels.indexOf(channel);
        if (index > -1) {
          channels.splice(index, 1);
        }
        console.log(chalk.yellow(`✓ Removed channel: ${channel}`));
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  console.log(chalk.green('✓ Bot is running!'));
  console.log(chalk.cyan('💬 Commands: !sr, !np, !skip'));
}

main().catch(console.error);