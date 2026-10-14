import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export const desktop = isTauri();
export interface Snapshot {
  name: string;
  modelPath: string | null;
  expressionMap: Record<string, string> | null;
  emotion: string;
  mouthOpen: number;
  voiceState: string;
  connected: boolean;
  busy: boolean;
}
export interface Envelope {
  revision: number;
  snapshot: Snapshot;
}
export function action(action: string) {
  return invoke("desktop_action", { action });
}
export { invoke, listen };
