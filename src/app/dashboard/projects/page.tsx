import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadProjects } from "@/lib/dashboard";
import { ProjectsView } from "./ProjectsView";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!organizationId) redirect("/login");

  const projects = await loadProjects(organizationId);
  return <ProjectsView projects={projects} />;
}
