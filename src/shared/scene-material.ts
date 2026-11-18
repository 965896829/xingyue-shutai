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
export interface CharacterMaterial {
  character: string;
  values: string[];
  goal: { facts: string[]; plan: string[] };
  condition: { facts: string[]; pressure: string[] };
  interlocutor: { facts: string[]; scene: string[] };
  experience: { known: string[]; beliefs: string[]; lastChapter?: { outcome: string; facts: string[]; source: { path: string; hash: string } } };
  communication: string[];
  voice: { narration: number[]; dialogue: number[]; local: number[] };
  card?: { path: string; hash: string; excerptRanges: { start: number; end: number }[] };
}
export interface WritingMaterials {
  version: number;
  characters?: CharacterMaterial[];
  authorPreferences: string;
  narrator: { instruction: string; scenes: { scene: string; narration?: string }[] };
  focalExperience: { scenes: SceneMaterial[]; currentStateIds: string[]; experienceIds: string[]; beliefIds: string[] };
  dialogueIntent: { scene: string; character?: string; to?: string; relationship?: string; intent?: string }[];
  historicalMechanisms: { chapter: number; scene: string; conflict: string; strategy: string; response: string; solution: string; change: string; reward: string; cost?: string; protectedRepetition: string; sources: SourceRef[]; category: 'model_judgment' | 'accepted_memory_summary' }[];
  boundary: string;
}
