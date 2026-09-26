"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"

export function HandoverDecision({ id, needsName, defaultName }: { id: string; needsName: boolean; defaultName: string }) {
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [pending, startTransition] = useTransition()

  return (
    <div className="grid gap-3">
      {needsName ? (
        <div className="grid gap-1.5">
          <Label htmlFor="h-full-name">Your full name</Label>
          <Input id="h-full-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          disabled={pending || (needsName && name.trim().length < 2)}
          onClick={() =>
            startTransition(async () => {
              const ok = await runRpc(
                createClient().rpc("accept_admin_handover", { p_id: id, p_full_name: name.trim() || undefined }),
                "You are now the admin.",
              )
              if (ok) {
                router.replace("/admin?tab=admins")
                router.refresh()
              }
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Accept
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const ok = await runRpc(createClient().rpc("decide_admin_handover", { p_id: id, p_decision: "declined" }), "Handover declined.")
              if (ok) {
                router.replace("/")
                router.refresh()
              }
            })
          }
        >
          <X aria-hidden="true" /> Decline
        </Button>
      </div>
    </div>
  )
}
