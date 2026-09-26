"use client"

import { useEffect } from "react"
import { RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="bg-card mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-red-50">
        <TriangleAlert className="text-critical size-5" aria-hidden="true" />
      </span>
      <h1 className="text-base font-semibold">This page couldn&apos;t load</h1>
      <p className="text-muted-foreground text-sm">
        The connection may have dropped. Your data is safe — nothing is saved until you confirm it.
      </p>
      <Button onClick={() => retry()}>
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  )
}
