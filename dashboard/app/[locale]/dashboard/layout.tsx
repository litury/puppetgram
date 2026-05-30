'use client';

import { type ReactNode } from 'react';
import { AuthGuard } from '@/components/AuthGuard';
import { AppSidebar } from '@/components/AppSidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
