import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Upload, FileText, CheckSquare,
  Settings, Mic, Moon, Sun, Radio, ChevronLeft, ChevronRight, LogOut,
  BarChart2, Users,
} from 'lucide-react';
import { NavPage } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface SidebarNavProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
  darkMode: boolean;
  onToggleDark: () => void;
  pendingActionItems: number;
  isLive?: boolean;
  userEmail?: string | null;
  onSignOut: () => void;
}

const navItems = [
  { id: 'dashboard'    as NavPage, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload'       as NavPage, label: 'Upload',     icon: Upload },
  { id: 'meetings'     as NavPage, label: 'Meetings',   icon: FileText },
  { id: 'action-items' as NavPage, label: 'Tasks',      icon: CheckSquare, badge: true },
  { id: 'analytics'   as NavPage, label: 'Analytics',  icon: BarChart2 },
  { id: 'team'        as NavPage, label: 'Team',        icon: Users },
  { id: 'settings'    as NavPage, label: 'Settings',    icon: Settings },
];

export function SidebarNav({
  currentPage, onNavigate, darkMode, onToggleDark, pendingActionItems, isLive, userEmail, onSignOut,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const activePage = currentPage === 'meeting-detail' ? 'meetings' : currentPage === 'live' ? 'live' : currentPage;

  useEffect(() => {
    try { localStorage.setItem('sidebar_collapsed', String(collapsed)); } catch { /* storage unavailable */ }
  }, [collapsed]);

  return (
    <TooltipProvider delayDuration={150}>

      {/* ━━━ DESKTOP SIDEBAR ━━━ */}
      <aside
        className="
          relative hidden lg:flex flex-col h-full flex-shrink-0
          bg-sidebar border-r border-sidebar-border
          transition-[width] duration-200 ease-in-out
        "
        style={{ width: collapsed ? 60 : 236 }}
      >
        {/* Logo */}
        <div className={`
          flex items-center gap-3 border-b border-sidebar-border flex-shrink-0
          ${collapsed ? 'px-4 py-[18px] justify-center' : 'px-5 py-[18px]'}
        `}>
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-indigo-500/30">
            <Mic className="w-[15px] h-[15px] text-white" />
          </div>
          {!collapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[14.5px] font-semibold text-white tracking-tight whitespace-nowrap">
                MeetSummary
              </span>
              {isLive && (
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
              )}
            </div>
          )}
        </div>

        {/* Live CTA */}
        <div className={`pt-3 pb-2 ${collapsed ? 'px-2.5' : 'px-3'}`}>
          {collapsed ? (
            <DeskTooltip label="Start Live Session">
              <button
                onClick={() => onNavigate('live')}
                className={`
                  w-full flex items-center justify-center py-2.5 rounded-lg border transition-all
                  ${currentPage === 'live'
                    ? 'bg-red-500 border-red-500 text-white'
                    : 'border-red-500/25 text-red-400 hover:bg-red-500/10'}
                `}
              >
                <Radio className={`w-4 h-4 ${currentPage === 'live' ? 'animate-pulse' : ''}`} />
              </button>
            </DeskTooltip>
          ) : (
            <button
              onClick={() => onNavigate('live')}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all text-left
                ${currentPage === 'live'
                  ? 'bg-red-500 border-red-500 text-white'
                  : 'border-red-500/20 text-red-400 hover:bg-red-500/8 bg-red-500/[0.04]'}
              `}
            >
              <Radio className={`w-[15px] h-[15px] flex-shrink-0 ${currentPage === 'live' ? 'animate-pulse' : ''}`} />
              <span className="text-[13px] font-medium flex-1">Live Meeting</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/12 text-red-400 border border-red-500/20 uppercase tracking-wider">
                Live
              </span>
            </button>
          )}
        </div>

        <div className="mx-3 my-1 border-t border-sidebar-border" />

        {/* Nav items */}
        <nav className={`flex flex-col gap-0.5 flex-1 py-1 ${collapsed ? 'px-2.5' : 'px-3'}`}>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activePage === item.id;

            if (collapsed) {
              return (
                <DeskTooltip key={item.id} label={item.label}>
                  <button
                    onClick={() => onNavigate(item.id)}
                    className={`
                      relative w-full flex items-center justify-center py-2.5 rounded-lg transition-all
                      ${isActive
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                        : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-100'}
                    `}
                  >
                    <Icon className="w-[17px] h-[17px]" />
                    {item.badge && pendingActionItems > 0 && (
                      <span className="absolute top-1 right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold leading-none">
                        {pendingActionItems > 9 ? '9+' : pendingActionItems}
                      </span>
                    )}
                  </button>
                </DeskTooltip>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-left transition-all
                  ${isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                    : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-100'}
                `}
              >
                <Icon className="w-[17px] h-[17px] flex-shrink-0" />
                <span className="text-[13px] font-medium flex-1">{item.label}</span>
                {item.badge && pendingActionItems > 0 && (
                  <span className={`
                    text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums
                    ${isActive ? 'bg-white/20 text-white' : 'bg-indigo-500 text-white'}
                  `}>
                    {pendingActionItems}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom — user + theme + logout */}
        <div className={`
          border-t border-sidebar-border py-3.5 flex items-center
          ${collapsed ? 'px-2.5 flex-col gap-2 justify-center' : 'px-4 gap-3'}
        `}>
          {collapsed ? (
            <>
              <DeskTooltip label={darkMode ? 'Light mode' : 'Dark mode'}>
                <button
                  onClick={onToggleDark}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-sidebar-accent transition-colors"
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              </DeskTooltip>
              <DeskTooltip label="Sign out">
                <button
                  onClick={onSignOut}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-sidebar-accent transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </DeskTooltip>
            </>
          ) : (
            <>
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-400/25 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-semibold text-indigo-300">
                  {userEmail ? userEmail.slice(0, 2).toUpperCase() : 'MS'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-slate-300 truncate leading-none">
                  {userEmail ?? 'My Workspace'}
                </p>
                <p className="text-[10.5px] text-slate-500 mt-0.5 truncate leading-none">Signed in</p>
              </div>
              <button
                onClick={onToggleDark}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-sidebar-accent transition-colors flex-shrink-0"
                aria-label={darkMode ? 'Light mode' : 'Dark mode'}
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onSignOut}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-sidebar-accent transition-colors flex-shrink-0"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="absolute -right-3 top-[76px] z-10 w-6 h-6 rounded-full border border-border bg-card flex items-center justify-center shadow-sm hover:bg-accent transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
            : <ChevronLeft  className="w-3 h-3 text-muted-foreground" />}
        </button>
      </aside>

      {/* ━━━ MOBILE TOP BAR ━━━ */}
      <header className="
        lg:hidden fixed top-0 left-0 right-0 z-50 h-14
        bg-sidebar border-b border-sidebar-border
        flex items-center justify-between px-4
      ">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center shadow-sm shadow-indigo-500/30">
            <Mic className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[15px] font-semibold text-white tracking-tight">MeetSummary</span>
          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onNavigate('live')}
            className={`
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-all
              ${currentPage === 'live'
                ? 'bg-red-500 border-red-500 text-white'
                : 'border-red-500/25 text-red-400 hover:bg-red-500/10'}
            `}
          >
            <Radio className={`w-3.5 h-3.5 ${currentPage === 'live' ? 'animate-pulse' : ''}`} />
            Live
          </button>
          <button
            onClick={onToggleDark}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white transition-colors"
            aria-label="Toggle theme"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ━━━ MOBILE BOTTOM NAV ━━━ */}
      <nav className="
        lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16
        bg-card/95 backdrop-blur-md border-t border-border
        flex items-stretch
        safe-area-inset-bottom
      ">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`
                relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors
                ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
              `}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-primary" />
              )}
              <div className="relative">
                <Icon className="w-[19px] h-[19px]" />
                {item.badge && pendingActionItems > 0 && (
                  <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold leading-none">
                    {pendingActionItems > 9 ? '9+' : pendingActionItems}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>

    </TooltipProvider>
  );
}

function DeskTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="text-[12px]">{label}</TooltipContent>
    </Tooltip>
  );
}
