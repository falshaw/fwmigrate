"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, CircleAlert, Search, Mail, Lock } from "lucide-react";
import { AppBackground, LogoMark } from "@/components/AppBackground";
import { ThemeToggle } from "@/components/ThemeToggle";
import { safeCallbackPath } from "@/lib/ui/safe-redirect";

const FEATURES = [
  {
    icon: ArrowRightLeft,
    title: "Five vendors",
    text: "PAN-OS, ASA, Check Point, FortiOS, Junos.",
    tone: "bg-accent-soft text-accent",
  },
  {
    icon: Check,
    title: "Deterministic",
    text: "Same config in, same config out. AI only explains.",
    tone: "bg-teal-soft text-teal",
  },
  {
    icon: CircleAlert,
    title: "Review every rule",
    text: "Flags on everything that does not map 1:1.",
    tone: "bg-amber-soft text-amber",
  },
  {
    icon: Search,
    title: "Clean up first",
    text: "Shadowed, unused and over-permissive rules.",
    tone: "bg-red-soft text-red",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push(safeCallbackPath(new URLSearchParams(window.location.search).get("callbackUrl")));
    }
  }

  return (
    <>
      <AppBackground />
      <ThemeToggle className="fixed top-4 right-4 z-20" />

      <div className="mx-auto grid min-h-screen max-w-[1180px] gap-6 p-4 pt-16 lg:grid-cols-[1.2fr_1fr] lg:px-6 lg:py-8">
        <section className="glass flex flex-col !rounded-3xl p-[22px] lg:px-[34px] lg:py-[30px]">
          <div className="flex items-center gap-2.5 text-base font-bold">
            <LogoMark size={38} />
            <span>
              FW <span className="text-accent">Migrate</span>
            </span>
          </div>

          <div className="my-auto max-w-[460px] py-6 lg:py-10">
            <div className="eyebrow !text-accent mb-3">Firewall migration</div>
            <h1 className="!text-[30px] lg:!text-[34px] !leading-[1.12] !tracking-[-0.03em]">
              Move the rule base,
              <br />
              <span className="accent-text">check every rule.</span>
            </h1>
            <p className="mt-3.5 text-[15px] text-ink-65">
              Translates firewall configs between five vendors, flags what does
              not map, and you approve each rule before export. Runs locally.
            </p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="card flex gap-3 !rounded-2xl p-3.5">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${f.tone}`}
                    aria-hidden
                  >
                    <f.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <b className="block text-[13.5px] font-semibold">{f.title}</b>
                    <small className="text-[12.5px] text-ink-65">{f.text}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-[18px] text-[11.5px] text-ink-65">
            {[
              ["var(--ink-45)", "Runs locally"],
              ["var(--accent)", "MIT licensed"],
              ["var(--teal)", "Configs stay here"],
            ].map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: c }}
                  aria-hidden
                />
                {t}
              </span>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center justify-center pb-8 lg:p-6">
          <div className="w-full max-w-[340px]">
            <form
              onSubmit={handleSubmit}
              className="glass !rounded-3xl px-7 py-[30px]"
             
            >
              <h1 className="!text-[22px]">Sign in</h1>
              <div className="mt-0.5 mb-[22px] text-[13px] text-ink-65">
                Welcome back
              </div>

              <div className="grid gap-3">
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute top-1/2 left-[13px] h-4 w-4 -translate-y-1/2 text-ink-45"
                    aria-hidden
                  />
                  <input
                    className="input input-glass !pl-10"
                    type="email"
                    placeholder="Email"
                    aria-label="Email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute top-1/2 left-[13px] h-4 w-4 -translate-y-1/2 text-ink-45"
                    aria-hidden
                  />
                  <input
                    className="input input-glass !pl-10"
                    type="password"
                    placeholder="Password"
                    aria-label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="mt-3 text-[13px] font-medium text-red" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary mt-5 !h-[46px] w-full shadow-[0_8px_22px_rgba(37,99,235,0.35)]"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <div
                className="code mt-[22px] !rounded-[14px] !px-3.5 !py-3 !text-xs !whitespace-pre-wrap break-words"
                aria-label="Quick start"
              >
                <span className="k">$</span> docker compose up{" "}
                <span className="s">-d --build</span>
                {"\n"}
                <span className="c">
                  app · postgres · redis healthy · http://localhost:3004
                </span>
              </div>
            </form>
            <div className="mt-[18px] text-center text-[11.5px] text-ink-45">
              Open source · github.com/falshaw/fwmigrate
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
