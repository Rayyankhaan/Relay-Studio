# ShortsPilot – Xavier Memes

A dedicated YouTube Meme Shorts management, validation, scheduling, and official publishing platform built exclusively for **Xavier Memes**.

## Fixed Channel Metadata (Locked)

Every uploaded Short enforces the exact central metadata defined in `config/constants.ts`:

- **Title:** `Xavier memes funny #memes #xavier #xaviermemes`
- **Description:** `Xavier memes funny #memes #xavier #xaviermemes`
- **Tags:** `memes`, `xavier`, `xaviermemes`

AI meme analysis and trending audio research never alter or override the title, description, or hashtags.

## Project Structure

- `config/constants.ts` — Central locked title, hashtags, daily slots (`09:00`, `12:00`, `15:00`, `18:00`, `21:00` `America/New_York`), and file limits.
- `database/db.ts` — SQLite persistence (`node:sqlite` with JSON fallback on serverless environments) and AES-256-GCM encryption for stored OAuth refresh tokens.
- `backend/folders.ts` — Lifecycle folder management (`shorts/{incoming,processing,scheduled,published,failed}/`, `database/thumbnails/`, `logs/`).
- `backend/validator.ts` — Real `ffprobe` dimension/FPS/codec/audio inspection and `ffmpeg` thumbnail extraction without modifying source videos.
- `backend/scheduler.ts` — SHA-256 duplicate prevention, 5-per-day EST slot assignment, incoming folder scanner, pause/resume, reschedule, and failure retry handling.
- `backend/youtube.ts` — Official YouTube Data API v3 (`channels.list`, resumable `videos.insert`, `videos.list`) and YouTube Analytics API (`reports`) integration.
- `backend/audioResearch.ts` — Server-side Gemini Search grounding (`gemini-4-hydrogen`) for live trending meme sound research.
- `ai/memeAnalyzer.ts` — Optional server-side Gemini AI meme context, safety, copyright risk, and audio mood analyzer.
- `automation/*.py` & `ai/meme_analyzer.py` — Companion Python 3.10+ automation CLI scripts and local folder watcher.
- `src/` — Dark-mode-first React + Tailwind CSS dashboard (`Overview`, `Upload Shorts`, `Video Library`, `Publishing Queue`, `Calendar`, `Trending Audio`, `Analytics`, `YouTube Channel`, `Settings`).

## Local Setup

1. Install Node.js 22+ and FFmpeg/FFprobe (`ffmpeg` and `ffprobe` available in `PATH`).
2. Copy `.env.example` to `.env` and fill in your server secrets:
   - `GEMINI_API_KEY` — Enables AI Meme Analysis & Trending Meme Audio Research.
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` — Optional for offline server refresh token storage (in addition to client Google OAuth popup).
   - `TOKEN_ENCRYPTION_SECRET` — 32+ character key for AES-256-GCM refresh token encryption.
   - `DASHBOARD_PASSWORD` — Optional password gate for deployed dashboards.
3. Run:
   ```bash
   npm install
   npm run dev
   ```
   Or on Windows, double-click **`run.bat`**.
4. Open `http://localhost:3000`.

## Google Cloud & YouTube API Setup

1. Enable **YouTube Data API v3** and **YouTube Analytics API** in your Google Cloud Console project.
2. Configure your OAuth 2.0 Consent Screen and add authorized redirect URI `<APP_URL>/api/youtube/oauth/callback` if using server-side offline refresh tokens.
3. Scopes requested:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly` (for Analytics US/CA/AU viewer geography)
4. Note: Unverified Google Cloud OAuth projects restrict API-uploaded videos to **Private** until Google verification is completed.

## Production & Vercel Deployment

- **Full Node Host (recommended for local folder watcher & FFmpeg):**
  ```bash
  npm run build
  NODE_ENV=production npm start
  ```
- **Vercel Serverless:** `api/[...route].ts` and `vercel.json` route `/api/*` requests to the Express API. Videos larger than Vercel's serverless payload limit are cached in browser IndexedDB and uploaded directly to YouTube via official resumable upload (`videos.insert`).
