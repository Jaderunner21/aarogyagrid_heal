"use client"

import { LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut } from "@/app/actions"
import { t, type Lang } from "@/lib/i18n"
import type { ShellUser } from "@/components/heal/app-shell"

function initials(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase()
}

export function UserCard({ user, lang }: { user: ShellUser; lang: Lang }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
      <Avatar className="size-9">
        <AvatarFallback className="bg-primary-soft text-primary text-xs font-semibold">
          {initials(user.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{user.name}</div>
        <div className="text-muted-foreground truncate text-xs">
          {t(lang, user.role === "phc_staff" && user.phcPosition === "medical_officer" ? "role.phc_doctor" : `role.${user.role}`)}
        </div>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" aria-label={t(lang, "user.signOut")}>
          <LogOut />
        </Button>
      </form>
    </div>
  )
}

export function UserMenu({ user, lang }: { user: ShellUser; lang: Lang }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 rounded-full" aria-label={`${user.name} menu`}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary-soft text-primary text-xs font-semibold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-foreground truncate text-sm font-medium">{user.name}</div>
          <div className="text-muted-foreground truncate text-xs">
          {t(lang, user.role === "phc_staff" && user.phcPosition === "medical_officer" ? "role.phc_doctor" : `role.${user.role}`)}
        </div>
          <div className="text-muted-foreground truncate text-xs">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              {t(lang, "user.signOut")}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
