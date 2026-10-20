import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadProjects } from "@/lib/dashboard";
import { ProjectsView } from "./ProjectsView";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  const user = session?.user as { organizationId?: string; role?: string } | undefined;
  const organizationId = user?.organizationId;
  if (!organizationId) redirect("/login");

  const projects = await loadProjects(organizationId);
  // Deleting is admin-only in the API; only admins see the button
  return <ProjectsView projects={projects} canDelete={user?.role === "ADMIN"} />;
}
