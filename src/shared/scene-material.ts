import type { SourceRef } from './studio';

export interface SceneMaterial {
  scene: string;
  kind: 'plan';
  source: { path: string; hash: string };
  sceneFunction?: string;
  focalCharacter?: string;
  concern?: string;
  personalMeaning?: string;
  interpretation?: string;
  attention?: string;
  experience?: string;
  dialogueIntent?: string;
  addressees?: string;
  relationship?: string;
  narration?: string;
  voice?: string;
  additions?: string;
  goal?: string;
  pressure?: string;
  actions?: string;
  result?: string;
}
export interface WritingMaterials {
  version: number;
  authorPreferences: string;
  narrator: { instruction: string; scenes: { scene: string; narration?: string }[] };
  focalExperience: { scenes: SceneMaterial[]; currentStateIds: string[]; experienceIds: string[]; beliefIds: string[] };
  dialogueIntent: { scene: string; character?: string; to?: string; relationship?: string; intent?: string }[];
  historicalMechanisms: { chapter: number; scene: string; conflict: string; strategy: string; response: string; solution: string; change: string; reward: string; cost?: string; protectedRepetition: string; sources: SourceRef[]; category: 'model_judgment' | 'accepted_memory_summary' }[];
  boundary: string;
}
