"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

export function SetPasswordForm({ next }: { next: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [pending, startTransition] = useTransition()
  const mismatch = confirm.length > 0 && confirm !== password

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const { error } = await createClient().auth.updateUser({ password })
          if (error) {
            toast.error(error.message)
            return
          }
          toast.success("Password saved.")
          router.replace(next)
          router.refresh()
        })
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="pw">New password</Label>
        <Input id="pw" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pw2">Repeat password</Label>
        <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        {mismatch ? <p className="text-critical text-xs">The passwords don&apos;t match.</p> : null}
      </div>
      <Button type="submit" disabled={pending || password.length < 8 || password !== confirm}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save and continue
      </Button>
    </form>
  )
}
