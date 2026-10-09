export type SupportedLocale = "en" | "zh-Hans" | "ko" | "ja" | "fr" | "ru";

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  "en",
  "zh-Hans",
  "ko",
  "ja",
  "fr",
  "ru",
];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export type LocaleResources = Record<string, Record<string, unknown>>;

export interface LocaleAdapter {
  /** False keeps language selection local to this client. Defaults to true. */
  syncWithAccount?: boolean;
  getUserChoice(): string | null;
  getSystemPreferences(): string[];
  persist(locale: SupportedLocale): void;
}
