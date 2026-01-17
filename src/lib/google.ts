import { google, youtube_v3 } from "googleapis";
import YTMusic from "ytmusic-api";
import { compareTwoStrings } from "string-similarity";

export type SongPick = {
  title: string;
  artists: string[];
  videoId: string;
  duration?: string;
};

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUrl?: string;
  ytmCookies?: string;
  requestsPlaylistName?: string;
};

export default class Google {
  private oauth2: InstanceType<typeof google.auth.OAuth2>;
  private youtube: youtube_v3.Youtube;
  private ytmusic: YTMusic;
  private requestsPlaylistName: string;

  constructor(cfg: GoogleConfig) {
    const {
      clientId,
      clientSecret,
      refreshToken,
      redirectUrl,
      ytmCookies,
      requestsPlaylistName = "Requests",
    } = cfg;

    this.oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
    this.oauth2.setCredentials({ refresh_token: refreshToken });
    this.youtube = google.youtube({ version: "v3", auth: this.oauth2 });

    this.ytmusic = new YTMusic();
    if (ytmCookies) {
      (this.ytmusic as any).__cookies = ytmCookies;
    }
    this.requestsPlaylistName = requestsPlaylistName;
  }

  async initialize(): Promise<void> {
    try {
      const cookies = (this.ytmusic as any).__cookies;
      if (cookies) {
        await this.ytmusic.initialize(cookies);
      } else {
        await this.ytmusic.initialize();
      }
      await this.ensureGoogleAccess();
      console.log('✓ YouTube Music initialized successfully');
    } catch (error) {
      console.error('Failed to initialize YouTube Music:', error);
      throw error;
    }
  }

  async searchBestMatch(query: string): Promise<SongPick | null> {
    try {
      const results = (await this.ytmusic.search(query)) as any[];
      
      console.log('Raw search results:', JSON.stringify(results.slice(0, 2), null, 2));
      
      const songs = results.filter((r) => (r.type || "").toLowerCase() === "song");
      
      if (!songs.length) {
        console.log(`No songs found for query: ${query}`);
        return null;
      }

      const ranked = songs
        .map((s) => {
          const artistNames = (s.artists || []).map((a: any) => a.name || a).join(" ");
          const hay = `${s.title ?? s.name ?? ""} ${artistNames}`.toLowerCase();
          const score = compareTwoStrings(query.toLowerCase(), hay);
          return { s, score };
        })
        .sort((a, b) => b.score - a.score);

      const top = ranked[0].s;
      
      // Extract title - try multiple fields
      const title = top.title || top.name || "Unknown Song";
      
      // Extract artists - handle different formats from YouTube Music API
      let artists: string[] = [];
      
      // Case 1: top.artists is an array of objects with 'name' property
      if (top.artists && Array.isArray(top.artists)) {
        artists = top.artists.map((a: any) => {
          if (typeof a === 'string') return a;
          return a.name || 'Unknown Artist';
        }).filter(Boolean);
      } 
      // Case 2: top.artist is a single object with 'name' property
      else if (top.artist && typeof top.artist === 'object' && top.artist.name) {
        artists = [top.artist.name];
      }
      // Case 3: top.artist is a string
      else if (top.artist && typeof top.artist === 'string') {
        artists = [top.artist];
      }
      
      if (artists.length === 0) {
        artists = ['Unknown Artist'];
      }
      
      console.log('Matched song:', { title, artists, videoId: top.videoId });
      
      return {
        title,
        artists,
        videoId: top.videoId,
        duration: top.duration,
      };
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }

  private async ensureGoogleAccess(): Promise<void> {
    try {
      await this.oauth2.getAccessToken();
    } catch (error) {
      console.error('Failed to get Google access token:', error);
      throw new Error('Google authentication failed. Check your GOOGLE_REFRESH_TOKEN.');
    }
  }

  async ensurePlaylist(name: string): Promise<string> {
    try {
      await this.ensureGoogleAccess();

      let pageToken: string | undefined;
      let foundId: string | undefined;

      // Search for existing playlist
      do {
        const resp = await this.youtube.playlists.list({
          mine: true,
          part: ["id", "snippet"],
          maxResults: 50,
          pageToken,
        });

        for (const pl of resp.data.items ?? []) {
          if (pl.snippet?.title?.trim().toLowerCase() === name.trim().toLowerCase()) {
            foundId = pl.id ?? undefined;
            break;
          }
        }
        pageToken = resp.data.nextPageToken ?? undefined;
      } while (!foundId && pageToken);

      if (foundId) {
        console.log(`✓ Found existing playlist: ${name} (${foundId})`);
        return foundId;
      }

      // Create new playlist if not found
      const created = await this.youtube.playlists.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { 
            title: name, 
            description: "Auto-created by song request bot" 
          },
          status: { privacyStatus: "unlisted" },
        },
      });

      const newId = created.data.id;
      if (!newId) {
        throw new Error("Failed to create playlist");
      }
      
      console.log(`✓ Created new playlist: ${name} (${newId})`);
      return newId;
    } catch (error) {
      console.error('Playlist error:', error);
      throw error;
    }
  }

  async addToPlaylist(playlistId: string, videoId: string): Promise<void> {
    try {
      await this.ensureGoogleAccess();
      await this.youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      });
      console.log(`✓ Added video ${videoId} to playlist ${playlistId}`);
    } catch (error: any) {
      if (error.message?.includes('videoNotFound')) {
        throw new Error('Video not found or unavailable');
      }
      if (error.message?.includes('playlistItemsNotAccessible')) {
        throw new Error('Cannot access playlist. Check permissions.');
      }
      console.error('Add to playlist error:', error);
      throw error;
    }
  }

  async skipFirst(playlistId: string): Promise<boolean> {
    try {
      await this.ensureGoogleAccess();
      
      const list = await this.youtube.playlistItems.list({
        part: ["id", "snippet"],
        playlistId,
        maxResults: 1,
      });
      
      const first = list.data.items?.[0];
      if (!first?.id) {
        return false;
      }

      await this.youtube.playlistItems.delete({ id: first.id });
      console.log(`✓ Skipped first item in playlist`);
      return true;
    } catch (error) {
      console.error('Skip error:', error);
      throw error;
    }
  }

  async nowPlaying(playlistId: string): Promise<{ title: string; channel: string; url?: string } | null> {
    try {
      await this.ensureGoogleAccess();
      
      const list = await this.youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId,
        maxResults: 1,
      });
      
      const it = list.data.items?.[0];
      if (!it) {
        return null;
      }
      
      const title = it.snippet?.title ?? "Unknown";
      const channel = it.snippet?.videoOwnerChannelTitle || it.snippet?.channelTitle || "Unknown";
      const videoId = it.contentDetails?.videoId;
      
      return { 
        title, 
        channel, 
        url: videoId ? `https://youtu.be/${videoId}` : undefined 
      };
    } catch (error) {
      console.error('Now playing error:', error);
      throw error;
    }
  }

  async clearPlaylist(playlistId: string): Promise<void> {
    try {
      await this.ensureGoogleAccess();
      
      let pageToken: string | undefined;
      let totalDeleted = 0;
      
      do {
        const page = await this.youtube.playlistItems.list({
          part: ["id"],
          playlistId,
          maxResults: 50,
          pageToken,
        });
        
        const ids = (page.data.items ?? [])
          .map((i) => i.id!)
          .filter(Boolean);

        for (const id of ids) {
          await this.youtube.playlistItems.delete({ id });
          totalDeleted++;
        }
        
        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);
      
      console.log(`✓ Cleared ${totalDeleted} items from playlist`);
    } catch (error) {
      console.error('Clear playlist error:', error);
      throw error;
    }
  }
}