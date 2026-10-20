"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  Activity,
  Layers,
  ArrowRightLeft,
  CheckCircle2,
  Plus,
  ChevronRight,
  FolderOpen,
  FileText,
  Settings,
  Cpu,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  sourceVendor: string;
  targetVendor: string;
  status: string;
  ruleCount: number;
  objectCount?: number;
  natRuleCount?: number;
  parseConfidence?: number;
  createdAt: string;
  updatedAt?: string;
  createdBy?: { name: string | null; email: string };
}

interface DashboardData {
  projects: Project[];
  totalMigrations: number;
  activeCount: number;
  completedCount: number;
  totalRules: number;
  vendorsUsed: number;
  successRate: number;
}

const vendorLabels: Record<string, string> = {
  PALO_ALTO: "Palo Alto",
  CISCO_ASA: "Cisco ASA",
  CISCO_FTD: "Cisco FTD",
  CHECKPOINT: "Check Point",
  FORTINET: "Fortinet",
  JUNIPER_SRX: "Juniper SRX",
  SOPHOS: "Sophos XG/SFOS",
  SONICWALL: "SonicWall",
  WATCHGUARD: "WatchGuard",
  PFSENSE: "pfSense",
  MIKROTIK: "MikroTik",
};

const STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; border: string; label: string; pulse?: boolean }
> = {
  CREATED: {
    bg: "rgba(107, 114, 128, 0.1)",
    text: "#9ca3af",
    border: "rgba(107, 114, 128, 0.3)",
    label: "Created",
  },
  IMPORTING: {
    bg: "rgba(59, 130, 246, 0.1)",
    text: "#3b82f6",
    border: "rgba(59, 130, 246, 0.3)",
    label: "Importing",
    pulse: true,
  },
  PARSING: {
    bg: "rgba(59, 130, 246, 0.1)",
    text: "#3b82f6",
    border: "rgba(59, 130, 246, 0.3)",
    label: "Parsing",
    pulse: true,
  },
  PARSED: {
    bg: "rgba(59, 130, 246, 0.1)",
    text: "#3b82f6",
    border: "rgba(59, 130, 246, 0.3)",
    label: "Parsed",
  },
  ANALYZING: {
    bg: "rgba(245, 158, 11, 0.1)",
    text: "#f59e0b",
    border: "rgba(245, 158, 11, 0.3)",
    label: "Analyzing",
    pulse: true,
  },
  ANALYZED: {
    bg: "rgba(245, 158, 11, 0.1)",
    text: "#f59e0b",
    border: "rgba(245, 158, 11, 0.3)",
    label: "Analyzed",
  },
  TRANSLATING: {
    bg: "rgba(167, 139, 250, 0.1)",
    text: "#a78bfa",
    border: "rgba(167, 139, 250, 0.3)",
    label: "Translating",
    pulse: true,
  },
  TRANSLATED: {
    bg: "rgba(167, 139, 250, 0.1)",
    text: "#a78bfa",
    border: "rgba(167, 139, 250, 0.3)",
    label: "Translated",
  },
  REVIEWING: {
    bg: "rgba(249, 115, 22, 0.1)",
    text: "#f97316",
    border: "rgba(249, 115, 22, 0.3)",
    label: "Reviewing",
    pulse: true,
  },
  APPROVED: {
    bg: "rgba(16, 185, 129, 0.1)",
    text: "#10b981",
    border: "rgba(16, 185, 129, 0.3)",
    label: "Approved",
  },
  EXPORTED: {
    bg: "rgba(16, 185, 129, 0.1)",
    text: "#10b981",
    border: "rgba(16, 185, 129, 0.3)",
    label: "Exported",
  },
  ARCHIVED: {
    bg: "rgba(107, 114, 128, 0.1)",
    text: "#9ca3af",
    border: "rgba(107, 114, 128, 0.3)",
    label: "Archived",
  },
};

const ACTIVE_STATUSES = [
  "IMPORTING",
  "PARSING",
  "PARSED",
  "ANALYZING",
  "ANALYZED",
  "TRANSLATING",
  "TRANSLATED",
  "REVIEWING",
];
const COMPLETED_STATUSES = ["APPROVED", "EXPORTED"];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/projects")
      .then((r) => r.json())
      .then((result) => {
        const projects: Project[] = result.projects || [];
        const activeCount = projects.filter((p) =>
          ACTIVE_STATUSES.includes(p.status),
        ).length;
        const completedCount = projects.filter((p) =>
          COMPLETED_STATUSES.includes(p.status),
        ).length;
        const totalRules = projects.reduce(
          (sum, p) => sum + (p.ruleCount || 0),
          0,
        );
        const vendorSet = new Set<string>();
        projects.forEach((p) => {
          vendorSet.add(p.sourceVendor);
          vendorSet.add(p.targetVendor);
        });
        const successRate =
          projects.length > 0
            ? Math.round((completedCount / projects.length) * 100)
            : 0;

        setData({
          projects,
          totalMigrations: projects.length,
          activeCount,
          completedCount,
          totalRules,
          vendorsUsed: vendorSet.size,
          successRate,
        });
        setLoading(false);
      })
      .catch(() => {
        setData({
          projects: [],
          totalMigrations: 0,
          activeCount: 0,
          completedCount: 0,
          totalRules: 0,
          vendorsUsed: 0,
          successRate: 0,
        });
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 skeleton h-72 rounded-2xl" />
          <div className="lg:col-span-4 skeleton h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  const d = data!;

  return (
    <div className="space-y-8">
      {/* ============ Hero Header ============ */}
      <div className="card-luxury !p-0 overflow-hidden">
        <div className="relative px-8 pt-8 pb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-[#c9a227]/[0.04] to-[#a78bfa]/[0.04]" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#c9a227] to-[#a78bfa] flex items-center justify-center shadow-lg shadow-[#c9a227]/20">
                <Shield className="w-7 h-7 text-black" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight">
                  Fw<span className="text-[#c9a227]">Migrate</span>
                </h1>
                <p className="text-sm text-white/35 mt-1 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  AI-Powered Firewall Migration
                  <span className="text-white/20">
                    &middot; {d.vendorsUsed} Vendor
                    {d.vendorsUsed !== 1 ? "s" : ""}
                  </span>
                </p>
              </div>
            </div>

            {/* Status pills */}
            <div className="hidden lg:flex items-center gap-3">
              <StatusPill
                count={d.activeCount}
                label="Active"
                color="#a78bfa"
              />
              <StatusPill
                count={d.completedCount}
                label="Complete"
                color="#10b981"
              />
              <div className="flex gap-2 ml-2">
                <Link
                  href="/dashboard/projects/new"
                  className="btn-primary !py-2 !px-4 flex items-center gap-1.5 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> New
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.04] border-t border-white/[0.06]">
          <StatCell
            icon={<FolderOpen className="w-4 h-4" />}
            label="Total Migrations"
            value={`${d.totalMigrations}`}
            color="#3b82f6"
          />
          <StatCell
            icon={<Layers className="w-4 h-4" />}
            label="Rules Translated"
            value={`${d.totalRules}`}
            color="#a78bfa"
          />
          <StatCell
            icon={<ArrowRightLeft className="w-4 h-4" />}
            label="Vendors Supported"
            value="6"
            color="#f97316"
          />
          <StatCell
            icon={<CheckCircle2 className="w-4 h-4" />}
            label="Success Rate"
            value={d.totalMigrations > 0 ? `${d.successRate}%` : "--"}
            sub={d.totalMigrations > 0 ? undefined : "no data"}
            color="#10b981"
          />
        </div>
      </div>

      {/* ============ Main Grid ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Migrations */}
        <div className="lg:col-span-8 card-luxury !p-0 overflow-hidden">
          <div className="px-6 py-5 border-b border-white/[0.06] bg-white/[0.02] flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(167, 139, 250, 0.15)" }}
              >
                <Layers className="w-4 h-4 text-[#a78bfa]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white/80">
                  Recent Migrations
                </h3>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mt-0.5">
                  Sorted by last updated
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/projects/new"
              className="text-xs font-bold text-white/40 uppercase tracking-wide hover:text-[#c9a227] transition-colors flex items-center gap-1"
            >
              New Project <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {d.projects.length === 0 ? (
            <div className="text-center py-16">
              <Shield className="w-12 h-12 text-white/10 mx-auto mb-4" />
              <p className="text-white/50 text-sm font-bold">
                No migration projects yet
              </p>
              <p className="text-white/25 text-xs mt-1">
                Create your first migration project to get started
              </p>
              <div className="flex justify-center gap-3 mt-6">
                <Link
                  href="/dashboard/projects/new"
                  className="btn-primary flex items-center gap-2 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Create Migration
                </Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {d.projects.slice(0, 8).map((project) => {
                const status =
                  STATUS_CONFIG[project.status] || STATUS_CONFIG.CREATED;
                return (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.02] transition-all duration-200 group"
                  >
                    {/* Vendor direction indicator */}
                    <div className="w-1.5 h-8 rounded-full shrink-0 bg-gradient-to-b from-[#f97316] to-[#a78bfa]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/80 group-hover:text-[#c9a227] transition-colors truncate">
                        {project.name}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-[#f97316] font-medium">
                          {vendorLabels[project.sourceVendor] ||
                            project.sourceVendor}
                        </span>
                        <ArrowRightLeft className="w-3 h-3 text-white/20" />
                        <span className="text-xs text-[#a78bfa] font-medium">
                          {vendorLabels[project.targetVendor] ||
                            project.targetVendor}
                        </span>
                        <span className="text-xs text-white/20">&middot;</span>
                        <span className="text-xs text-white/30">
                          {project.ruleCount} rules
                        </span>
                      </div>
                    </div>

                    {/* Status badge with pulse */}
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0"
                      style={{
                        background: status.bg,
                        color: status.text,
                        borderColor: status.border,
                      }}
                    >
                      <span className="relative flex items-center justify-center">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full"
                          style={{ background: status.text }}
                        />
                        {status.pulse && (
                          <span
                            className="absolute inline-block w-1.5 h-1.5 rounded-full animate-ping opacity-40"
                            style={{ background: status.text }}
                          />
                        )}
                      </span>
                      {status.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-[#c9a227] transition-colors shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 space-y-6">
          {/* Quick Access */}
          <div className="card-luxury">
            <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-4">
              Quick Access
            </h3>
            <div className="space-y-2">
              {[
                {
                  href: "/dashboard/projects/new",
                  label: "New Migration",
                  icon: <Plus className="w-4 h-4" />,
                  from: "#c9a227",
                  to: "#b8911f",
                },
                {
                  href: "/dashboard",
                  label: "All Projects",
                  icon: <FolderOpen className="w-4 h-4" />,
                  from: "#3b82f6",
                  to: "#2563eb",
                },
                {
                  href: "/dashboard",
                  label: "Export History",
                  icon: <FileText className="w-4 h-4" />,
                  from: "#10b981",
                  to: "#059669",
                },
                {
                  href: "/dashboard",
                  label: "AI Assistant",
                  icon: <Cpu className="w-4 h-4" />,
                  from: "#a78bfa",
                  to: "#7c3aed",
                },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/15 transition-all duration-200 group"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${item.from}, ${item.to})`,
                    }}
                  >
                    {item.icon}
                  </div>
                  <span className="text-sm font-semibold text-white/60 group-hover:text-white transition-colors">
                    {item.label}
                  </span>
                  <ChevronRight className="w-4 h-4 text-white/15 ml-auto group-hover:text-white/40 transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Supported Vendors */}
          <div className="card-luxury !p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(249, 115, 22, 0.15)" }}
              >
                <Settings className="w-4 h-4 text-[#f97316]" />
              </div>
              <h3 className="text-sm font-bold text-white/80">
                Supported Vendors
              </h3>
            </div>
            <div className="p-4 space-y-1">
              {[
                { name: "Palo Alto", color: "#f97316" },
                { name: "Cisco ASA / FTD", color: "#3b82f6" },
                { name: "Check Point", color: "#10b981" },
                { name: "Fortinet", color: "#ef4444" },
                { name: "Juniper SRX", color: "#a78bfa" },
              ].map((vendor) => (
                <div
                  key={vendor.name}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                >
                  <div className="relative shrink-0">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: vendor.color }}
                    />
                  </div>
                  <span className="text-xs text-white/60 font-medium">
                    {vendor.name}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <span className="text-[10px] text-white/25">
                      Parser + Generator
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Migration Workflow */}
          <div className="card-luxury !p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(201, 162, 39, 0.15)" }}
              >
                <Activity className="w-4 h-4 text-[#c9a227]" />
              </div>
              <h3 className="text-sm font-bold text-white/80">Workflow</h3>
            </div>
            <div className="p-4 space-y-1">
              {[
                { step: "01", label: "Import", desc: "Paste or upload config" },
                { step: "02", label: "Parse", desc: "Extract rules & objects" },
                {
                  step: "03",
                  label: "Analyze",
                  desc: "Detect shadows & conflicts",
                },
                {
                  step: "04",
                  label: "Translate",
                  desc: "Convert to target vendor",
                },
                {
                  step: "05",
                  label: "Export",
                  desc: "Download migration plan",
                },
              ].map((item, i) => (
                <div
                  key={item.step}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-white/40 shrink-0">
                    {item.step}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white/60">
                      {item.label}
                    </p>
                    <p className="text-[10px] text-white/25">{item.desc}</p>
                  </div>
                  {i < 4 && (
                    <ChevronRight className="w-3 h-3 text-white/10 ml-auto shrink-0" />
                  )}
                  {i === 4 && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981]/40 ml-auto shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Local Components ============ */

function StatusPill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 rounded-full border"
      style={{ background: `${color}08`, borderColor: `${color}20` }}
    >
      <span className="text-xl font-extrabold tabular-nums" style={{ color }}>
        {count}
      </span>
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: `${color}99` }}
      >
        {label}
      </span>
    </div>
  );
}

function StatCell({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-[#0a1628] px-6 py-4 flex items-center gap-4">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/30">
          {label}
        </div>
        <div className="flex items-baseline gap-1">
          <span
            className="text-xl font-extrabold tabular-nums"
            style={{ color }}
          >
            {value}
          </span>
          {sub && <span className="text-xs text-white/30">{sub}</span>}
        </div>
      </div>
    </div>
  );
}
