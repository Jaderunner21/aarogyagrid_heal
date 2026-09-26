"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { HealLogo, HealMark } from "@/components/heal/logo"
import { NavIcon } from "@/components/heal/nav-icon"
import { LanguageToggle } from "@/components/heal/language-toggle"
import { NotificationBell } from "@/components/heal/notification-bell"
import { RealtimeSync } from "@/components/heal/realtime-sync"
import { ViewBadge } from "@/components/heal/view-badge"
import { VIEW_COLOR, viewKindOf, type PhcPosition } from "@/lib/view-kind"
import { UserMenu, UserCard } from "@/components/heal/user-menu"
import { AskHeal } from "@/components/heal/ask-heal"
import { APP_NAME } from "@/lib/brand"
import { t, type Lang } from "@/lib/i18n"
import type { NavItem, Role } from "@/lib/roles"
import { cn } from "@/lib/utils"

export type ShellUser = { id: string; name: string; email: string; role: Role; phcPosition?: PhcPosition }

type Props = {
  user: ShellUser
  nav: NavItem[]
  crumbs: string[]
  lang: Lang
  children: React.ReactNode
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function AppShell({ user, nav, crumbs, lang, children }: Props) {
  const pathname = usePathname()
  const isPhc = user.role === "phc_staff"
  const view = viewKindOf(user.role, user.phcPosition)

  return (
    <div className="min-h-svh">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Link href="/" aria-label={`${APP_NAME} home`}>
            <HealLogo tagline={t(lang, "app.tagline")} />
          </Link>
        </div>
        <SidebarNav nav={nav} pathname={pathname} lang={lang} />
        <div className="border-t p-3">
          <UserCard user={user} lang={lang} />
        </div>
      </aside>

      <div className="lg:pl-60">
        {/* Top bar */}
        <header
          className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-t-[3px] px-4 backdrop-blur sm:px-6 lg:h-16"
          style={{ borderTopColor: VIEW_COLOR[view].fg }}
        >
          {!isPhc ? (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="size-10 lg:hidden" aria-label={t(lang, "nav.menu")}>
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="h-16 justify-center border-b px-5">
                  <SheetTitle asChild>
                    <div>
                      <HealLogo tagline={t(lang, "app.tagline")} />
                    </div>
                  </SheetTitle>
                </SheetHeader>
                <SidebarNav nav={nav} pathname={pathname} lang={lang} />
              </SheetContent>
            </Sheet>
          ) : null}
          <Link href="/" className="lg:hidden" aria-label={`${APP_NAME} home`}>
            <HealMark className="size-7" />
          </Link>

          <ViewBadge kind={view} lang={lang} />
          <Breadcrumb crumbs={crumbs} />

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {user.role === "district_officer" || user.role === "state_admin" || user.role === "national_admin" ? <AskHeal /> : null}
            <LanguageToggle lang={lang} />
            <RealtimeSync userId={user.id} label={{ live: t(lang, "app.live"), polling: t(lang, "app.polling") }} />
            <NotificationBell userId={user.id} role={user.role} lang={lang} />
            <UserMenu user={user} lang={lang} />
          </div>
        </header>

        <main id="main" className={cn("mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6", isPhc && "pb-24 lg:pb-6")}>
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar for PHC staff */}
      {isPhc ? (
        <nav
          aria-label="Primary"
          className="bg-background fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {nav.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-5" />
                {t(lang, item.label)}
              </Link>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

function SidebarNav({ nav, pathname, lang }: { nav: NavItem[]; pathname: string; lang: Lang }) {
  const items: NavItem[] = [...nav, { href: "/notifications", label: "nav.notifications", icon: "notifications" }]
  return (
    <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {items.map((item) => {
        const active = isActive(pathname, item)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <NavIcon name={item.icon} className="size-4" />
            {t(lang, item.label)}
          </Link>
        )
      })}
    </nav>
  )
}

function Breadcrumb({ crumbs }: { crumbs: string[] }) {
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Scope" className="hidden min-w-0 sm:block">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c}-${i}`} className={cn("flex min-w-0 items-center gap-1", !last && "hidden sm:flex")}>
              <span className={cn("truncate", last ? "font-semibold" : "text-muted-foreground")}>{c}</span>
              {!last ? <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" /> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
