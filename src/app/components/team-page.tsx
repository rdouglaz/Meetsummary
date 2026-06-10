import { useState, useEffect } from 'react';
import { Users, Plus, Mail, Loader2, Check, X, Crown, Shield, UserCircle, Building2, AlertCircle, Trash2, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { supabase } from '../../lib/supabase';
import { NavPage } from '../types';

interface TeamPageProps { onNavigate: (page: NavPage) => void }

interface Org   { id: string; name: string; owner_id: string; plan: string; created_at: string }
interface Member { id: string; email: string; role: string; status: string; user_id: string | null; created_at: string }

const roleIcon: Record<string, React.ElementType> = { owner: Crown, admin: Shield, member: UserCircle };
const roleBadge: Record<string, string> = {
  owner:  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  admin:  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  member: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
};
const statusBadge: Record<string, string> = {
  active:  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  removed: 'bg-muted text-muted-foreground',
};

export function TeamPage({ onNavigate }: TeamPageProps) {
  const [loading, setLoading]       = useState(true);
  const [org, setOrg]               = useState<Org | null>(null);
  const [members, setMembers]       = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isOwner, setIsOwner]       = useState(false);

  // Create org form
  const [orgName, setOrgName]       = useState('');
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('member');
  const [inviting, setInviting]       = useState(false);
  const [inviteMsg, setInviteMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  // General error
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Check if user owns an org
      const { data: ownedOrgs } = await supabase
        .from('organizations')
        .select('*')
        .eq('owner_id', user.id)
        .limit(1);

      if (ownedOrgs && ownedOrgs.length > 0) {
        const o = ownedOrgs[0] as Org;
        setOrg(o);
        setIsOwner(true);
        await loadMembers(o.id);
        return;
      }

      // Check if user is a member of an org
      const { data: membership } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);

      if (membership && membership.length > 0) {
        const { data: memberOrg } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', membership[0].org_id)
          .single();
        if (memberOrg) {
          setOrg(memberOrg as Org);
          setIsOwner(false);
          await loadMembers(memberOrg.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers(orgId: string) {
    const { data } = await supabase
      .from('org_members')
      .select('*')
      .eq('org_id', orgId)
      .neq('status', 'removed')
      .order('created_at');
    setMembers((data ?? []) as Member[]);
  }

  async function createOrg() {
    if (!orgName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: newOrg, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: orgName.trim(), owner_id: user.id, plan: 'team' })
        .select()
        .single();
      if (orgErr) throw orgErr;

      // Add owner as a member
      await supabase.from('org_members').insert({
        org_id: newOrg.id,
        user_id: user.id,
        email: user.email ?? '',
        role: 'owner',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      setOrg(newOrg as Org);
      setIsOwner(true);
      await loadMembers(newOrg.id);
      // Pendo Track: organization created
      (window as any).pendo?.track('organization_created', {
        orgName: orgName.trim().slice(0, 100),
        ownerId: user.id,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !org) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteMsg({ ok: false, text: 'Invalid email address' });
      return;
    }
    setInviting(true);
    setInviteMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: invErr } = await supabase.from('org_members').insert({
        org_id: org.id,
        email,
        role: inviteRole,
        status: 'pending',
        invited_by: user?.id ?? null,
      });
      if (invErr) throw invErr;
      setInviteMsg({ ok: true, text: `Invite sent to ${email}` });
      setInviteEmail('');
      await loadMembers(org.id);
      // Pendo Track: team member invited
      (window as any).pendo?.track('team_member_invited', {
        orgId: org.id,
        inviteeRole: inviteRole,
        invitedBy: user?.id ?? 'unknown',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invite failed';
      setInviteMsg({ ok: false, text: msg.includes('unique') ? 'This person is already in your organization' : msg });
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(memberId: string) {
    await supabase.from('org_members').update({ status: 'removed' }).eq('id', memberId);
    await loadMembers(org!.id);
    // Pendo Track: team member removed
    (window as any).pendo?.track('team_member_removed', {
      orgId: org!.id,
      removedMemberId: memberId,
      removedByUserId: currentUserId ?? 'unknown',
    });
  }

  async function leaveOrg() {
    if (!org || !currentUserId) return;
    await supabase.from('org_members').update({ status: 'removed' }).eq('org_id', org.id).eq('user_id', currentUserId);
    // Pendo Track: user left organization
    (window as any).pendo?.track('user_left_organization', {
      orgId: org.id,
      userId: currentUserId,
    });
    setOrg(null);
    setMembers([]);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[13px]">Loading team…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="px-4 sm:px-6 py-4 max-w-[760px] mx-auto w-full">
          <h1 className="text-[17px] font-semibold text-foreground">Team Workspace</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">Share meetings and collaborate across your organization</p>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-[760px] mx-auto w-full flex flex-col gap-4">

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-destructive/8 border border-destructive/20">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-[12.5px] text-destructive">{error}</p>
          </div>
        )}

        {/* No org → create */}
        {!org && (
          <Card className="border-border shadow-none">
            <CardHeader className="px-5 pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <CardTitle className="text-[14.5px] font-semibold">Create Your Organization</CardTitle>
                  <p className="text-[12px] text-muted-foreground mt-0.5">Invite teammates to share a meeting library and collaborate.</p>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[12.5px]">Organization Name</Label>
                <Input
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createOrg()}
                  placeholder="Acme Corp, My Team…"
                  className="h-9 bg-background"
                />
              </div>
              {createError && <p className="text-[12px] text-destructive">{createError}</p>}
              <Button onClick={createOrg} disabled={!orgName.trim() || creating} className="gap-2 w-fit">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {creating ? 'Creating…' : 'Create Organization'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Has org → show dashboard */}
        {org && (
          <>
            {/* Org info */}
            <Card className="border-border shadow-none">
              <CardContent className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-indigo-500/25">
                    <span className="text-[16px] font-bold text-white">{org.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-foreground">{org.name}</p>
                    <p className="text-[12px] text-muted-foreground">{members.filter(m => m.status === 'active').length} active members · {org.plan} plan</p>
                  </div>
                  {!isOwner && (
                    <button onClick={leaveOrg} className="text-[12px] text-muted-foreground hover:text-destructive transition-colors">Leave</button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Shared meetings note */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
              <Globe className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12.5px] font-semibold text-blue-600 dark:text-blue-400">Shared library active</p>
                <p className="text-[11.5px] text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                  All meetings you create are visible to your organization. Go to{' '}
                  <button onClick={() => onNavigate('meetings')} className="underline hover:no-underline">Meetings</button>{' '}
                  to see everyone's meetings.
                </p>
              </div>
            </div>

            {/* Invite (owner/admin only) */}
            {isOwner && (
              <Card className="border-border shadow-none">
                <CardHeader className="px-5 pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <CardTitle className="text-[14.5px] font-semibold">Invite Members</CardTitle>
                  </div>
                </CardHeader>
                <Separator />
                <CardContent className="px-5 py-4 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Input
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && inviteMember()}
                      placeholder="colleague@company.com"
                      className="flex-1 h-9 bg-background"
                    />
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger className="w-28 h-9 bg-background flex-shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={inviteMember} disabled={inviting || !inviteEmail.trim()} size="sm" className="h-9 gap-1.5 flex-shrink-0">
                      {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Invite
                    </Button>
                  </div>
                  {inviteMsg && (
                    <p className={`text-[12px] flex items-center gap-1 ${inviteMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                      {inviteMsg.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {inviteMsg.text}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Members list */}
            <Card className="border-border shadow-none">
              <CardHeader className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <CardTitle className="text-[14.5px] font-semibold">Members ({members.length})</CardTitle>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="px-5 py-4">
                {members.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground py-4 text-center">No members yet. Invite teammates above.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-border/60">
                    {members.map(m => {
                      const RoleIcon = roleIcon[m.role] ?? UserCircle;
                      const isSelf = m.user_id === currentUserId;
                      return (
                        <div key={m.id} className="flex items-center gap-3 py-3">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <span className="text-[11px] font-semibold text-muted-foreground">{m.email.slice(0, 2).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">{m.email}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge[m.role] ?? roleBadge.member}`}>
                                <RoleIcon className="w-2.5 h-2.5 inline mr-0.5" />{m.role}
                              </span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusBadge[m.status] ?? ''}`}>{m.status}</span>
                              {isSelf && <span className="text-[10px] text-muted-foreground">you</span>}
                            </div>
                          </div>
                          {isOwner && !isSelf && m.role !== 'owner' && (
                            <button onClick={() => removeMember(m.id)} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
