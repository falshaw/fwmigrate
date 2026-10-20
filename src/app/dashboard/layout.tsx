import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppBackground } from "@/components/AppBackground";
import { Sidebar } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <>
      <AppBackground />
      <div className="mx-auto flex max-w-[1340px] flex-col gap-3 p-4 lg:flex-row lg:items-start lg:gap-[18px] lg:px-6 lg:py-7">
        <Sidebar
          name={session.user.name ?? ""}
          email={session.user.email ?? ""}
        />
        <main className="glass w-full min-w-0 flex-1 p-[18px] sm:px-7 sm:pt-[26px] sm:pb-7">
          {children}
        </main>
      </div>
    </>
  );
}
