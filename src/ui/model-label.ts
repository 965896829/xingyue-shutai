import type { Profile } from '../shared/types';

export function modelLabel(profile: Profile, profiles: Profile[]): string {
  if (profiles.filter((p) => p.model === profile.model).length < 2) return profile.model;
  return `${profile.model}（${profile.name} · ${profile.protocol}）`;
}
