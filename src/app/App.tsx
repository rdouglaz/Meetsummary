import { useState, useEffect, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import type { AuthSession as Session } from '@supabase/supabase-js';
import { NavPage } from './types';
import { SidebarNav } from './components/sidebar-nav';
import { DashboardPage } from './components/dashboard-page';
import { UploadPage } from './components/upload-page';
import { MeetingsPage } from './components/meetings-page';
import { MeetingDetail } from './components/meeting-detail';
import { ActionItemsPage } from './components/action-items-page';
import { SettingsPage } from './components/settings-page';
import { LiveMeetingPage } from './components/live-meeting-page';
import { AuthPage } from './components/auth-page';
import { SplashScreen } from './components/splash-screen';
import { AnalyticsPage } from './components/analytics-page';
import { TeamPage } from './components/team-page';
import { Toaster } from './components/ui/sonner';
import { supabase } from '../lib/supabase';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-full items-center justify-center bg-background p-8">
          <div className="max-w-lg w-full">
            <p className="text-[13px] font-semibold text-destructive mb-2">App failed to render</p>
            <pre className="text-[11px] text-muted-foreground bg-muted p-4 rounded-xl overflow-auto whitespace-pre-wrap break-all">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Favicon injection ────────────────────────────────────────────────────────
function injectFavicon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="#6366f1"/>
    <text x="16" y="22" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="700" fill="white" letter-spacing="-0.5">MS</text>
  </svg>`;
  const url  = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  // Remove existing favicons
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove());

  const link = document.createElement('link');
  link.rel   = 'icon';
  link.type  = 'image/svg+xml';
  link.href  = url;
  document.head.appendChild(link);
}

export default function App() {
  const [page, setPage]                     = useState<NavPage>('dashboard');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
  const [darkMode, setDarkMode]             = useState(false);
  const [pendingCount, setPendingCount]     = useState(0);
  // undefined = checking session; null = no session; Session = authenticated
  const [session, setSession]               = useState<Session | null | undefined>(undefined);
  // Show splash once per browser session
  const [showSplash, setShowSplash]         = useState(() => {
    try { return !sessionStorage.getItem('ms_splash_shown'); } catch { return true; }
  });

  // ── Favicon ─────────────────────────────────────────────────────────────────
  useEffect(() => { injectFavicon(); }, []);

  // ── Deep-link: ?meeting=<id> shared from the Share button ───────────────────
  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const meetingId = params.get('meeting');
    if (meetingId) {
      setSelectedMeetingId(meetingId);
      setPage('meeting-detail');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Dark mode ────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Pendo identify on sign-in ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;

    const identifyUser = async () => {
      const pendoPayload: Record<string, unknown> = {
        visitor: {
          id: session.user.id,
          email: session.user.email ?? '',
          createdAt: session.user.created_at,
        },
      };

      // Attempt to load account (org) metadata
      const userId = session.user.id;
      let org: { id: string; name: string; slug: string; plan: string; created_at: string } | null = null;

      const { data: ownedOrgs } = await supabase
        .from('organizations')
        .select('id, name, slug, plan, created_at')
        .eq('owner_id', userId)
        .limit(1);

      if (ownedOrgs && ownedOrgs.length > 0) {
        org = ownedOrgs[0] as typeof org;
      } else {
        const { data: membership } = await supabase
          .from('org_members')
          .select('org_id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1);

        if (membership && membership.length > 0) {
          const { data: memberOrg } = await supabase
            .from('organizations')
            .select('id, name, slug, plan, created_at')
            .eq('id', membership[0].org_id)
            .single();
          if (memberOrg) org = memberOrg as typeof org;
        }
      }

      if (org) {
        pendoPayload.account = {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          createdAt: org.created_at,
        };
      }

      pendo.identify(pendoPayload);
    };

    identifyUser();
  }, [session]);

  // ── Action items badge (only when authenticated) ──────────────────────────────
  useEffect(() => {
    if (!session) return;

    supabase
      .from('action_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
      .catch(() => {});

    const channel = supabase
      .channel('app_action_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_items' }, () => {
        supabase
          .from('action_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .then(({ count }) => setPendingCount(count ?? 0))
          .catch(() => {});
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  const navigate = (targetPage: NavPage, meetingId?: string) => {
    if (meetingId) setSelectedMeetingId(meetingId);
    setPage(targetPage);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    pendo.clearSession();
    setPage('dashboard');
    setPendingCount(0);
  };

  // ── Splash screen (once per session, covers the auth-check loading state too) ──
  if (showSplash) {
    return (
      <AppErrorBoundary>
        <SplashScreen onComplete={() => {
          try { sessionStorage.setItem('ms_splash_shown', '1'); } catch { /* */ }
          setShowSplash(false);
        }} />
        <Toaster />
      </AppErrorBoundary>
    );
  }

  // ── Auth check loading ────────────────────────────────────────────────────────
  if (session === undefined) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <AppErrorBoundary>
        <AuthPage />
        <Toaster />
      </AppErrorBoundary>
    );
  }

  const isLive = page === 'live';

  return (
    <AppErrorBoundary>
      <div className={`flex h-screen w-full overflow-hidden bg-background ${darkMode ? 'dark' : ''}`}>
        <SidebarNav
          currentPage={page}
          onNavigate={navigate}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(v => !v)}
          pendingActionItems={pendingCount}
          isLive={isLive}
          userEmail={session.user.email ?? null}
          onSignOut={handleSignOut}
        />

        <main className={`
          flex-1 bg-background
          pt-14 lg:pt-0
          ${isLive ? 'overflow-hidden pb-0' : 'overflow-auto pb-16 lg:pb-0'}
        `}>
          {page === 'dashboard'     && <DashboardPage onNavigate={navigate} />}
          {page === 'upload'        && <UploadPage onNavigate={navigate} />}
          {page === 'meetings'      && <MeetingsPage onNavigate={navigate} />}
          {page === 'meeting-detail' && (
            <div className="h-full">
              <MeetingDetail meetingId={selectedMeetingId} onNavigate={navigate} />
            </div>
          )}
          {page === 'action-items'  && <ActionItemsPage onNavigate={navigate} />}
          {page === 'analytics'     && <AnalyticsPage onNavigate={navigate} />}
          {page === 'team'          && <TeamPage onNavigate={navigate} />}
          {page === 'settings'      && <SettingsPage />}
          {page === 'live'          && (
            <div className="h-full overflow-hidden">
              <LiveMeetingPage onNavigate={navigate} />
            </div>
          )}
        </main>

        <Toaster />
      </div>
    </AppErrorBoundary>
  );
}
