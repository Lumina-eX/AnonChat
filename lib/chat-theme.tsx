"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ColorThemeId = "purple" | "ocean" | "sunset" | "forest" | "midnight";

export type ColorTheme = {
  id: ColorThemeId;
  name: string;
  description: string;
  preview: {
    primary: string;
    secondary: string;
    accent: string;
  };
  /**
   * CSS custom properties consumed by app/globals.css. Primary has separate
   * light/dark values so text on primary surfaces (and primary-coloured text)
   * meets WCAG AA contrast in both colour modes.
   */
  vars: Record<string, string>;
};

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "purple",
    name: "Purple",
    description: "Vibrant purple with cyan highlights",
    preview: { primary: "#9333ea", secondary: "#0891b2", accent: "#d946ef" },
    vars: {
      "--theme-primary-light": "oklch(0.55 0.25 280)",
      "--theme-primary-dark": "oklch(0.72 0.18 280)",
      "--theme-secondary": "oklch(0.5 0.2 200)",
      "--theme-accent": "oklch(0.7 0.22 300)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue with teal and coral",
    preview: { primary: "#1d4ed8", secondary: "#0d9488", accent: "#f97316" },
    vars: {
      "--theme-primary-light": "oklch(0.48 0.22 220)",
      "--theme-primary-dark": "oklch(0.7 0.16 220)",
      "--theme-secondary": "oklch(0.58 0.18 175)",
      "--theme-accent": "oklch(0.65 0.2 30)",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm amber with red and gold",
    preview: { primary: "#d97706", secondary: "#dc2626", accent: "#ca8a04" },
    vars: {
      "--theme-primary-light": "oklch(0.54 0.2 50)",
      "--theme-primary-dark": "oklch(0.74 0.16 50)",
      "--theme-secondary": "oklch(0.58 0.24 25)",
      "--theme-accent": "oklch(0.75 0.2 75)",
    },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Natural green with emerald and lime",
    preview: { primary: "#15803d", secondary: "#059669", accent: "#65a30d" },
    vars: {
      "--theme-primary-light": "oklch(0.5 0.18 145)",
      "--theme-primary-dark": "oklch(0.72 0.14 145)",
      "--theme-secondary": "oklch(0.6 0.18 165)",
      "--theme-accent": "oklch(0.68 0.2 120)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep indigo with violet and blue",
    preview: { primary: "#4338ca", secondary: "#7c3aed", accent: "#2563eb" },
    vars: {
      "--theme-primary-light": "oklch(0.52 0.23 260)",
      "--theme-primary-dark": "oklch(0.72 0.17 260)",
      "--theme-secondary": "oklch(0.6 0.22 290)",
      "--theme-accent": "oklch(0.62 0.2 240)",
    },
  },
];

const STORAGE_KEY = "anonchat-color-theme";

type ChatThemeContextValue = {
  colorThemeId: ColorThemeId;
  setColorTheme: (id: ColorThemeId) => void;
  themes: ColorTheme[];
};

const ChatThemeContext = createContext<ChatThemeContextValue>({
  colorThemeId: "purple",
  setColorTheme: () => {},
  themes: COLOR_THEMES,
});

function applyThemeVars(theme: ColorTheme) {
  const root = document.documentElement;
  // Older versions wrote --primary/--secondary/--accent directly, which
  // overrode the per-mode values in globals.css. Clear them.
  for (const legacy of ["--primary", "--secondary", "--accent"]) {
    root.style.removeProperty(legacy);
  }
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }
}

export function ChatThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorThemeId, setColorThemeId] = useState<ColorThemeId>("purple");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ColorThemeId | null;
    const theme = COLOR_THEMES.find((t) => t.id === saved) ?? COLOR_THEMES[0];
    setColorThemeId(theme.id);
    applyThemeVars(theme);
  }, []);

  const setColorTheme = useCallback((id: ColorThemeId) => {
    const theme = COLOR_THEMES.find((t) => t.id === id);
    if (!theme) return;
    setColorThemeId(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyThemeVars(theme);
  }, []);

  return (
    <ChatThemeContext.Provider value={{ colorThemeId, setColorTheme, themes: COLOR_THEMES }}>
      {children}
    </ChatThemeContext.Provider>
  );
}

export function useChatTheme() {
  return useContext(ChatThemeContext);
}
