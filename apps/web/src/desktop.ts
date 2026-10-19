import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export const desktop = isTauri();
export interface Snapshot {
  name: string;
  modelPath: string | null;
  expressionMap: Record<string, string> | null;
  motionMap: import("@companion/contracts").MotionMap | null;
  interactionState: import("@companion/contracts").CharacterState;
  emotion: string;
  mouthOpen: number;
  voiceState: string;
  connected: boolean;
  busy: boolean;
  animation?: { messageId:string; segmentId:string|null; index:number; phase:string; revision:number };
  motion?: { group:string; index:number; revision:number } | null;
}
export interface Envelope {
  revision: number;
  snapshot: Snapshot;
}
export function action(action: string) {
  return invoke("desktop_action", { action });
}
export { invoke, listen };
