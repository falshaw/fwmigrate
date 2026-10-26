import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AppBackground } from "@/components/AppBackground";
import { Sidebar } from "@/components/Sidebar";
import { RoleProvider, type UserRole } from "@/components/RoleContext";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Role and active flag from the database: an admin's change applies at once
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true },
  });
  const active = !!current?.isActive;

  return (
    <RoleProvider role={(active ? current!.role : "VIEWER") as UserRole}>
      <AppBackground />
      <div className="mx-auto flex max-w-[1340px] flex-col gap-3 p-4 lg:flex-row lg:items-start lg:gap-[18px] lg:px-6 lg:py-7">
        <Sidebar
          name={session.user.name ?? ""}
          email={session.user.email ?? ""}
        />
        <main className="glass w-full min-w-0 flex-1 p-[18px] sm:px-7 sm:pt-[26px] sm:pb-7">
          {active ? (
            children
          ) : (
            <div className="card p-8 text-center" role="alert">
              <p className="font-semibold">This account is deactivated.</p>
              <p className="mt-1 text-[13px] text-ink-65">Ask an admin to reactivate it, then sign in again.</p>
            </div>
          )}
        </main>
      </div>
    </RoleProvider>
  );
}
