import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Mic, Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

type Mode = 'signin' | 'signup' | 'forgot';

export function AuthPage() {
  const [mode, setMode]               = useState<Mode>('signin');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPwd, setShowPwd]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [emailSentFor, setEmailSentFor] = useState<'signup' | 'forgot' | null>(null);
  const [sentEmail, setSentEmail]     = useState('');

  const resetMessages = () => setError('');

  const switchMode = (next: Mode) => { setMode(next); resetMessages(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError('Email is required.'); return; }
    if (mode !== 'forgot' && !password) { setError('Password is required.'); return; }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email:    trimmedEmail,
          password,
        });
        if (err) throw err;
        // Pendo Track: user signed in
        (window as any).pendo?.track('user_signed_in', { authMethod: 'email' });
        // onAuthStateChange in App.tsx handles the redirect

      } else if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({
          email:    trimmedEmail,
          password,
        });
        if (err) throw err;
        // Pendo Track: user signed up
        (window as any).pendo?.track('user_signed_up', { authMethod: 'email' });
        setSentEmail(trimmedEmail);
        setEmailSentFor('signup');

      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: window.location.origin,
        });
        if (err) throw err;
        // Pendo Track: password reset requested
        (window as any).pendo?.track('password_reset_requested');
        setSentEmail(trimmedEmail);
        setEmailSentFor('forgot');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // ── Email sent confirmation screen ─────────────────────────────────────────
  if (emailSentFor) {
    const isSignup = emailSentFor === 'signup';
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-[400px]">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4">
              <Mic className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-[22px] font-bold text-foreground tracking-tight">MeetSummary</h1>
            <p className="text-[13px] text-muted-foreground mt-1">AI-powered meeting intelligence</p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm flex flex-col items-center text-center gap-5">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-foreground">Check your email</h2>
              <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
                {isSignup
                  ? <>We sent a confirmation link to <span className="font-medium text-foreground">{sentEmail}</span>. Click the link to activate your account.</>
                  : <>We sent a password reset link to <span className="font-medium text-foreground">{sentEmail}</span>. Check your inbox and follow the link to reset your password.</>}
              </p>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Didn't receive it? Check your spam folder or{' '}
              <button
                onClick={() => { setEmailSentFor(null); switchMode(emailSentFor); }}
                className="text-primary hover:underline"
              >
                try again
              </button>.
            </p>
            <button
              onClick={() => { setEmailSentFor(null); switchMode('signin'); }}
              className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </button>
          </div>

          <p className="text-center text-[11.5px] text-muted-foreground mt-5">
            Your data is encrypted and stored securely.
          </p>
        </div>
      </div>
    );
  }

  // ── Auth form ──────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[400px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">MeetSummary</h1>
          <p className="text-[13px] text-muted-foreground mt-1">AI-powered meeting intelligence</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-[17px] font-semibold text-foreground mb-5">
            {mode === 'signin' ? 'Sign in to your account'
              : mode === 'signup' ? 'Create an account'
              : 'Reset your password'}
          </h2>

          {error && (
            <div className="mb-4 px-3.5 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-[13px] leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="pl-9 h-10"
                disabled={loading}
              />
            </div>

            {/* Password (hidden on forgot) */}
            {mode !== 'forgot' && (
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type={showPwd ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? 'Create a password' : 'Password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="pl-9 pr-10 h-10"
                  disabled={loading}
                  minLength={mode === 'signup' ? 8 : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <p className="text-[11.5px] text-muted-foreground -mt-1">Password must be at least 8 characters.</p>
            )}

            {mode === 'signin' && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-[12.5px] text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <Button type="submit" disabled={loading} className="h-10 mt-1 w-full">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === 'signin' ? 'Sign in'
                : mode === 'signup' ? 'Create account'
                : 'Send reset link'}
            </Button>
          </form>

          {/* Toggle mode */}
          <div className="mt-5 pt-4 border-t border-border text-center">
            {mode === 'forgot' ? (
              <button
                onClick={() => switchMode('signin')}
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to sign in
              </button>
            ) : mode === 'signin' ? (
              <p className="text-[13px] text-muted-foreground">
                Don't have an account?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="text-primary hover:underline font-medium"
                >
                  Sign up free
                </button>
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Already have an account?{' '}
                <button
                  onClick={() => switchMode('signin')}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-[11.5px] text-muted-foreground mt-5">
          Your data is encrypted and stored securely.
        </p>
      </div>
    </div>
  );
}
