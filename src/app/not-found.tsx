import Link from "next/link";
import { AppBackground, LogoMark } from "@/components/AppBackground";

export default function NotFound() {
  return (
    <>
      <AppBackground />
      <main className="grid min-h-screen place-items-center p-4">
        <div className="glass w-full max-w-sm p-7 text-center" data-not-found>
          <div className="mb-5 flex justify-center">
            <LogoMark size={40} />
          </div>
          <div className="eyebrow">404</div>
          <h1 className="mt-1 !text-[22px]">Page not found</h1>
          <p className="mt-2 text-[13px] text-ink-65">
            This page does not exist or was moved.
          </p>
          <Link href="/dashboard" className="btn btn-primary mt-6 w-full">
            Back to overview
          </Link>
        </div>
      </main>
    </>
  );
}
