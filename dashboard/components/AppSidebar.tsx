'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bot,
  Radio,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useCurrentLocale } from '@/locales/client';
import { useAuth } from '@/hooks/useAuth';
import { isAdmin } from '@/lib/auth';
import { API_URL } from '@/lib/config';

type Locale = 'ru' | 'en';

interface NavItem {
  key: string;
  href: string; // без locale-префикса, добавляется в рендере
  icon: typeof LayoutDashboard;
  label: Record<Locale, string>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/dashboard', icon: LayoutDashboard, label: { ru: 'Обзор', en: 'Overview' } },
  { key: 'accounts', href: '/dashboard/accounts', icon: Bot, label: { ru: 'Аккаунты', en: 'Accounts' }, adminOnly: true },
  { key: 'channels', href: '/dashboard/channels', icon: Radio, label: { ru: 'Каналы', en: 'Channels' }, adminOnly: true },
  { key: 'comments', href: '/dashboard/comments', icon: MessageSquare, label: { ru: 'Комментарии', en: 'Comments' } },
  { key: 'coverage', href: '/dashboard/coverage', icon: BarChart3, label: { ru: 'Охват', en: 'Coverage' } },
  { key: 'settings', href: '/dashboard/settings', icon: Settings, label: { ru: 'Настройки', en: 'Settings' }, adminOnly: true },
];

function normalize(path: string): string {
  // убираем trailingSlash и locale-префикс для сравнения
  return path.replace(/\/$/, '').replace(/^\/(ru|en)/, '') || '/dashboard';
}

export function AppSidebar() {
  const locale = (useCurrentLocale() as Locale) || 'ru';
  const pathname = usePathname();
  const { user, logout } = useAuth(false);
  const admin = isAdmin(user);

  const current = normalize(pathname);
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || admin);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'User';
  const photoSrc = user?.telegramId ? `${API_URL}/api/photo/${user.telegramId}` : null;
  const initial = (user?.firstName || user?.username || 'U')[0]?.toUpperCase() ?? 'U';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-base">
            🎭
          </div>
          <span className="text-base font-semibold text-foreground group-data-[collapsible=icon]:hidden">
            Puppetgram
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{locale === 'ru' ? 'Навигация' : 'Navigation'}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = current === normalize(item.href);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label[locale]}>
                      <Link href={`/${locale}${item.href}`}>
                        <Icon />
                        <span>{item.label[locale]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5">
              {photoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoSrc}
                  alt={displayName}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-sm font-semibold text-accent-400">
                  {initial}
                </div>
              )}
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                {user?.username && (
                  <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                )}
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => logout()}
              tooltip={locale === 'ru' ? 'Выйти' : 'Log out'}
            >
              <LogOut />
              <span>{locale === 'ru' ? 'Выйти' : 'Log out'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
