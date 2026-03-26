export interface ThemePreviewJson {
  theme: string;
  configFile: string;
  overrides: Record<string, string>;
  resolvedTokens: Record<string, string>;
  samples: Record<string, string>;
}
