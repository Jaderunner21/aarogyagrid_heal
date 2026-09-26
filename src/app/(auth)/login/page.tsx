import type { Metadata } from "next"
import { Activity, ArrowLeftRight, BellRing, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { HealLogo, HealMark } from "@/components/heal/logo"
import { DemoLogin } from "@/components/heal/demo-login"
import { SignInForm } from "./sign-in-form"
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts"
import { APP_NAME } from "@/lib/brand"

export const metadata: Metadata = { title: "Sign in" }

const points = [
  { icon: Activity, text: "Forecasts each facility's demand for the next 30 days" },
  { icon: BellRing, text: "Warns before a medicine runs out, not after" },
  { icon: ArrowLeftRight, text: "Recommends moving surplus stock to where it's needed" },
  { icon: ShieldCheck, text: "AI proposes, people approve. Every step is signed and timed" },
]

export default function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  return (
    <main className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden overflow-hidden bg-[#0B5E58] p-10 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <HealMark className="size-9 ring-1 ring-white/20 rounded-lg" />
          <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="mt-auto max-w-md space-y-6">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            One live view of medicines, beds and staff, from the PHC to the state and the nation.
          </h1>
          <ul className="space-y-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-teal-50/90">
                <Icon className="mt-0.5 size-4 shrink-0 text-teal-200" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 text-xs text-teal-100/70">
          Demo data: facility names are real places in Udaipur, Rajsamand and Dungarpur (Rajasthan) and Aravalli and Sabarkantha (Gujarat); all stock, patient and staff
          numbers are synthetic.
        </p>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -right-8 size-48 rounded-full border border-white/10"
        />
      </section>

      <section className="flex flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
        <HealLogo className="lg:hidden" tagline="Health supply intelligence" />

        {!configured ? (
          <Card className="w-full max-w-md border-low/40">
            <CardHeader>
              <CardTitle>Supabase isn&apos;t configured</CardTitle>
              <CardDescription>
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev
                server.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Sign in to {APP_NAME}</CardTitle>
            <CardDescription>Medicine stock, beds and staff for every facility, in one live view.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>

        <DemoLogin accounts={DEMO_ACCOUNTS} />
      </section>
    </main>
  )
}
