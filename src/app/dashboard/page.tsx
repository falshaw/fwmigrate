import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadOverview } from "@/lib/dashboard";
import { OverviewView } from "./OverviewView";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const organizationId = (session?.user as { organizationId?: string } | undefined)
    ?.organizationId;
  if (!organizationId) redirect("/login");

  const data = await loadOverview(organizationId);
  return <OverviewView data={data} />;
}
