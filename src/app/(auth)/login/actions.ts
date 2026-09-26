"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { isDemoEmail } from "@/lib/demo-accounts"

export type SignInState = { error: string | null }

const credentials = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
})

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: error.message }
  redirect("/")
}

// The demo password stays on the server; the client only sends which demo account to use.
export async function demoSignIn(email: string): Promise<SignInState> {
  if (!isDemoEmail(email)) return { error: "Unknown demo account" }
  const password = process.env.DEMO_PASSWORD
  if (!password) return { error: "DEMO_PASSWORD is not set on the server" }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "Demo account not found. Run `npm run demo-users` once."
          : error.message,
    }
  }
  redirect("/")
}
