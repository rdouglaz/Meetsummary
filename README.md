# MeetSummary

**AI-Powered Meeting Transcription & Summarization SaaS Platform**

Transform audio/video recordings into structured, actionable insights with automated transcription, AI summaries, action items extraction, and real-time meeting copilot.

---

## Features

### 🎙️ Multi-Source Support
- **File Upload:** Zoom, Google Meet, Microsoft Teams, WhatsApp voice notes, manual uploads
- **Live Transcription:** Real-time transcription during active meetings with speaker diarization
- **Audio Formats:** MP3, WAV, M4A, WEBM, OGG, and more

### 🤖 AI-Powered Analysis
- **Automated Summaries:** Executive-level meeting overviews
- **Action Items Extraction:** Automatically detect tasks, owners, and due dates
- **Decision Tracking:** Capture key decisions made during meetings
- **Risk Detection:** Identify potential issues and blockers
- **Follow-up Emails:** Generate professional meeting recaps

### 📊 Export Integrations
- Google Sheets
- Notion
- ClickUp
- More coming soon...

### 🎨 Clean SaaS UI
- Stripe-style modern design
- Collapsible sidebar navigation
- Dark mode support
- Responsive across all devices

---

## Tech Stack

### Frontend
- **Framework:** React 18 + TypeScript
- **Styling:** Tailwind CSS v4
- **UI Components:** shadcn/ui (Radix UI primitives)
- **State Management:** React hooks + Supabase Realtime
- **Build Tool:** Vite

### Backend
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security)
- **Edge Functions:** Deno-based serverless functions
- **Storage:** Supabase Storage for audio files

### AI Services
- **Transcription:** Deepgram Nova-3 (streaming + pre-recorded)
- **Summarization:** OpenRouter LLM fallback chain
  - DeepSeek Chat v3.5
  - Qwen3 235B
  - Llama 3.1 Nemotron Ultra 253B
  - Gemma 3 27B
  - Mistral 7B Instruct
  - Llama 3.3 70B Instruct

---

## Quick Start

### Prerequisites
- Node.js 18+ or pnpm
- Supabase account ([supabase.com](https://supabase.com))
- Deepgram API key ([deepgram.com](https://deepgram.com))
- OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd meetsummary
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Supabase credentials
   ```

4. **Run development server**
   ```bash
   pnpm dev
   ```

5. **Open in browser**
   ```
   http://localhost:5173
   ```

---

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment instructions including:
- Database schema setup
- Edge Functions deployment
- Webhook configuration
- Production build steps

---

## Project Structure

```
meetsummary/
├── src/
│   ├── app/
│   │   ├── components/        # React components
│   │   │   ├── ui/            # shadcn/ui components
│   │   │   ├── dashboard-page.tsx
│   │   │   ├── meetings-page.tsx
│   │   │   ├── meeting-detail.tsx
│   │   │   ├── upload-page.tsx
│   │   │   ├── live-meeting-page.tsx
│   │   │   ├── action-items-page.tsx
│   │   │   └── settings-page.tsx
│   │   ├── App.tsx            # Main app component
│   │   └── types.ts           # TypeScript types
│   ├── lib/
│   │   ├── supabase.ts        # Supabase client
│   │   ├── deepgram-ws.ts     # Deepgram WebSocket client
│   │   ├── exports.ts         # Export integrations
│   │   └── database.types.ts  # Generated DB types
│   ├── services/
│   │   ├── meetings.ts        # Meeting CRUD operations
│   │   └── live-session.ts    # Live transcription service
│   └── styles/
│       ├── theme.css          # Tailwind v4 theme
│       └── fonts.css          # Font imports
├── supabase/
│   ├── schema.sql             # Database schema
│   └── functions/
│       ├── deepgram-proxy/    # WebSocket proxy for live transcription
│       ├── transcribe/        # Batch transcription for uploads
│       └── summarize/         # AI summarization
├── DEPLOYMENT.md              # Deployment guide
├── AUDIT_FIXES.md             # Recent fixes and improvements
└── README.md                  # This file
```

---

## Database Schema

### Core Tables
- **meetings:** Meeting records with metadata and status
- **live_sessions:** Active real-time transcription sessions
- **transcript_chunks:** Transcription segments with speaker diarization
- **ai_events:** AI-extracted events (action items, decisions, risks, questions)
- **action_items:** User-managed task list
- **summaries:** Generated meeting summaries

### Features
- Row Level Security (RLS) policies for multi-tenant security
- Realtime subscriptions for live updates
- Automatic timestamps and triggers
- Foreign key relationships with cascading deletes

---

## Edge Functions

### 1. `deepgram-proxy`
**Purpose:** WebSocket proxy for live transcription  
**Auth:** No JWT verification (allows browser connections)  
**Flow:** Browser → Edge Function → Deepgram Nova-3 API

### 2. `transcribe`
**Purpose:** Background transcription for uploaded files  
**Trigger:** Database webhook on `meetings` INSERT  
**Flow:** Upload → Webhook → Deepgram Pre-recorded API → Save chunks → Summarize

### 3. `summarize`
**Purpose:** AI-powered meeting analysis  
**Trigger:** Called by `transcribe` function or during live sessions  
**Features:** LLM fallback chain, action item extraction, decision tracking

---

## Environment Variables

### Frontend (`.env.local`)
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

### Edge Functions (Supabase Dashboard → Edge Functions → Secrets)
```bash
DEEPGRAM_API_KEY=your_deepgram_key
OPENROUTER_API_KEY=your_openrouter_key
SUPABASE_URL=auto-populated
SUPABASE_SECRET_KEYS=auto-populated
```

---

## Development

### Available Scripts

```bash
# Start dev server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Type check
pnpm type-check

# Deploy Edge Functions
supabase functions deploy deepgram-proxy --no-verify-jwt
supabase functions deploy transcribe
supabase functions deploy summarize
```

### Code Style
- TypeScript strict mode enabled
- React functional components with hooks
- Tailwind utility classes (avoid custom CSS)
- shadcn/ui components for consistency

---

## Security

✅ **Row Level Security (RLS)** enforced on all tables  
✅ **JWT-based authentication** with Supabase Auth  
✅ **API keys server-side only** (Edge Functions)  
✅ **CORS properly configured** for Edge Functions  
✅ **Input validation** on all user inputs  
✅ **No secret keys in browser** (uses `VITE_SUPABASE_PUBLISHABLE_KEY` only)  

---

## Recent Fixes

See **[AUDIT_FIXES.md](./AUDIT_FIXES.md)** for details on:
- ✅ Migrated from deprecated `SUPABASE_SERVICE_ROLE_KEY` to new `SUPABASE_SECRET_KEYS`
- ✅ Created missing `transcribe` Edge Function
- ✅ Updated webhook configuration for JWT-based auth
- ✅ Added comprehensive deployment documentation

---

## Roadmap

- [ ] Multi-language transcription support
- [ ] Calendar integrations (Google Calendar, Outlook)
- [ ] Custom AI prompts for industry-specific summaries
- [ ] Sentiment analysis
- [ ] Meeting analytics dashboard
- [ ] Team collaboration features
- [ ] Enterprise SSO support

---

## Support

For issues or questions:
- Check the **[DEPLOYMENT.md](./DEPLOYMENT.md)** troubleshooting section
- Review Supabase Dashboard logs (Database, Edge Functions, Realtime)
- Check browser console for frontend errors

---

## License

[Add your license here]

---

**Built with ❤️ using Supabase, Deepgram, and OpenRouter**
