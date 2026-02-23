export const ASSISTANT_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Polish",
  "Romanian",
  "Greek",
  "Russian",
  "Ukrainian",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Hindi",
  "Punjabi",
  "Urdu",
  "Bengali",
  "Gujarati",
  "Marathi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Japanese",
  "Korean",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Malay",
  "Filipino",
  "Swahili",
] as const;

export type AssistantLanguage = (typeof ASSISTANT_LANGUAGES)[number];

export const DEFAULT_ASSISTANT_LANGUAGE_PRIMARY: AssistantLanguage = "English";

export const normalizeLanguage = (value?: string) => {
  const trimmed = (value ?? "").trim();
  return trimmed;
};

export const isAssistantLanguage = (value: string): value is AssistantLanguage =>
  ASSISTANT_LANGUAGES.includes(value as AssistantLanguage);
