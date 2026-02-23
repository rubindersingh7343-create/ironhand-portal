export const ASSISTANT_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;

export type AssistantVoice = (typeof ASSISTANT_VOICES)[number];

export const DEFAULT_ASSISTANT_VOICE: AssistantVoice = "shimmer";

export const isAssistantVoice = (value: string): value is AssistantVoice =>
  ASSISTANT_VOICES.includes(value as AssistantVoice);
