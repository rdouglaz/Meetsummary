export type SpeakerMapping = Record<string, string>;

const KEY_PREFIX = 'ms_speaker_map_';

export function getSpeakerMap(meetingId: string): SpeakerMapping {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + meetingId);
    return raw ? (JSON.parse(raw) as SpeakerMapping) : {};
  } catch { return {}; }
}

export function setSpeakerMap(meetingId: string, map: SpeakerMapping): void {
  try { localStorage.setItem(KEY_PREFIX + meetingId, JSON.stringify(map)); } catch {}
}

export function applySpeakerMap(speaker: string, map: SpeakerMapping): string {
  return map[speaker] || speaker;
}

export function getGlobalProfiles(): { label: string; realName: string }[] {
  try {
    const raw = localStorage.getItem('ms_global_speakers');
    return raw ? (JSON.parse(raw) as { label: string; realName: string }[]) : [];
  } catch { return []; }
}

export function setGlobalProfiles(profiles: { label: string; realName: string }[]): void {
  try { localStorage.setItem('ms_global_speakers', JSON.stringify(profiles)); } catch {}
}

export function extractSpeakers(utterances: { speaker: string }[]): string[] {
  return Array.from(new Set(utterances.map(u => u.speaker))).sort();
}
