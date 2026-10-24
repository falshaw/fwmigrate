/**
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/apiHandler";
import prisma from "@/lib/prisma";
import { notFound, badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { suggestZoneMappings } from "@/lib/ai/ZoneMappingAI";
import { ollamaGenerate, isLlmEnabled } from "@/lib/ai/OllamaClient";
import type { FirewallVendor } from "@/lib/parsers/types";

const suggestSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  type: z.enum(["zones", "naming", "optimization"]),
});

type SuggestInput = z.infer<typeof suggestSchema>;

/**
 * POST /api/v1/ai/suggest
 * Get LLM suggestions for a project (optional, labelled as AI).
 *   - "zones": Suggests zone mappings based on source vendor zones
 *   - "naming": Suggests naming conventions for the target vendor
 *   - "optimization": Suggests rule consolidation and cleanup opportunities
 */
export const POST = apiHandler<SuggestInput>(
  async ({ body, organizationId }) => {
    if (!isLlmEnabled()) {
      return NextResponse.json(
        { error: "No LLM configured (LLM_PROVIDER=none)" },
        { status: 503 },
      );
    }
    const project = await prisma.migrationProject.findUnique({
      where: { id: body.projectId },
      include: {
        normalizedRules: {
          select: {
            name: true,
            position: true,
            action: true,
            sources: true,
            destinations: true,
            services: true,
            sourceZone: true,
            destinationZone: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!project) return notFound("Project not found");
    if (project.organizationId !== organizationId)
      return notFound("Project not found");

    if (body.type === "zones") {
      // Extract unique zones from rules
      const sourceZones = new Set<string>();
      for (const rule of project.normalizedRules) {
        if (rule.sourceZone) sourceZones.add(rule.sourceZone);
        if (rule.destinationZone) sourceZones.add(rule.destinationZone);
      }

      if (sourceZones.size === 0) {
        return badRequest(
          "No zones found in the project rules. Parse a configuration with zone data first.",
        );
      }

      const suggestions = await suggestZoneMappings(
        Array.from(sourceZones),
        project.sourceVendor as FirewallVendor,
        project.targetVendor as FirewallVendor,
      );

      logger.info("AI zone suggestions generated", {
        projectId: body.projectId,
        suggestionCount: suggestions.length,
      });

      return NextResponse.json({ type: "zones", suggestions });
    }

    if (body.type === "naming") {
      const ruleNames = project.normalizedRules.slice(0, 20).map((r) => r.name);

      const prompt = `You are a firewall migration expert. The following rules are being migrated from ${project.sourceVendor} to ${project.targetVendor}.

Current rule names: ${ruleNames.join(", ")}

Suggest a naming convention for the target platform (${project.targetVendor}) that follows best practices. Consider:
1. Vendor-specific naming limitations and conventions
2. Descriptive naming that includes zone, action, and purpose
3. Consistent formatting (e.g., kebab-case, PascalCase)

Respond in JSON: { "convention": "description of convention", "examples": [{ "original": "...", "suggested": "..." }], "recommendations": ["..."] }`;

      const response = await ollamaGenerate(prompt);

      let parsed;
      try {
        parsed = JSON.parse(
          response
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim(),
        );
      } catch {
        parsed = { convention: response, examples: [], recommendations: [] };
      }

      logger.info("AI naming suggestions generated", {
        projectId: body.projectId,
      });

      return NextResponse.json({ type: "naming", suggestions: parsed });
    }

    if (body.type === "optimization") {
      const ruleSummary = project.normalizedRules.slice(0, 50).map((r) => ({
        position: r.position,
        name: r.name,
        action: r.action,
        sources: r.sources,
        destinations: r.destinations,
        services: r.services,
        sourceZone: r.sourceZone,
        destinationZone: r.destinationZone,
      }));

      const prompt = `You are a firewall rule optimization expert. Analyze the following ${project.normalizedRules.length} rules (showing first ${ruleSummary.length}) for optimization opportunities.

Rules:
${JSON.stringify(ruleSummary, null, 2)}

Identify:
1. Rules that could be consolidated (similar source/dest/service)
2. Rules that could use address groups instead of individual IPs
3. Service objects that could be grouped
4. Any rules that appear unused or overly broad

Respond in JSON: { "consolidations": [{ "rules": [1, 2], "reason": "..." }], "groupOpportunities": [{ "type": "address|service", "members": ["..."], "suggestedName": "..." }], "generalRecommendations": ["..."] }`;

      const response = await ollamaGenerate(prompt);

      let parsed;
      try {
        parsed = JSON.parse(
          response
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim(),
        );
      } catch {
        parsed = {
          consolidations: [],
          groupOpportunities: [],
          generalRecommendations: [response],
        };
      }

      logger.info("AI optimization suggestions generated", {
        projectId: body.projectId,
      });

      return NextResponse.json({ type: "optimization", suggestions: parsed });
    }

    return badRequest(`Unknown suggestion type: ${body.type}`);
  },
  {
    schema: suggestSchema,
    rateLimit: { interval: 60_000, limit: 10 },
    rateLimitPrefix: "ai-suggest",
  },
);
