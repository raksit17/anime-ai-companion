import type { AnimationSegment } from "@companion/contracts";
export interface MotionCapability { group: string; index: number; }
export interface ModelCapabilities {
  motions: Record<string, number>;
  expressions: Set<string>;
}
/** Read capabilities from the loaded Live2D model, never from the LLM. */
export function inspectCapabilities(settings: {
  motions?: Record<string, unknown[]>;
  expressions?: Array<{name?: string; Name?: string}>;
}): ModelCapabilities {
  return {
    motions: Object.fromEntries(Object.entries(settings.motions ?? {})
      .map(([group, entries]) => [group, entries.length])),
    expressions: new Set((settings.expressions ?? []).map(e => e.name ?? e.Name ?? "")),
  };
}
export function allowedMotion(
  requested: AnimationSegment,
  capabilities: ModelCapabilities,
  approved: ReadonlySet<string> = new Set(),
): MotionCapability | null {
  if (requested.type !== "action" || !requested.motion) return null;
  const { group, index = 0 } = requested.motion;
  // Model availability alone is not semantic approval for an action.
  if (!approved.has(group + ":" + index)) return null;
  const count = capabilities.motions[group] ?? 0;
  return Number.isInteger(index) && index >= 0 && index < count ? {group,index} : null;
}
