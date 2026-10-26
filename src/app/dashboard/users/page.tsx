import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PageHeader } from "@/components/ProjectHeader";
import { UsersView } from "./UsersView";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth();
  const me = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } })
    : null;

  if (me?.role !== "ADMIN")
    return (
      <div>
        <PageHeader eyebrow="Tools" title="Users" />
        <div className="card p-8 text-center text-[13px] text-ink-65" role="alert">
          Only admins manage users.
        </div>
      </div>
    );

  return <UsersView myId={me.id} />;
}
