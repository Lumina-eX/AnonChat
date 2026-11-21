"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Moon, Palette, Sun, X } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { useChatTheme } from "@/lib/chat-theme";
import { cn } from "@/lib/utils";

export function ThemeSettingsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { colorThemeId, setColorTheme, themes } = useChatTheme();

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <button
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="Appearance settings"
        >
          <Palette className="w-5 h-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border border-border/50 bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl">
          <div className="flex items-start justify-between mb-5">
            <div>
              <Dialog.Title className="text-lg font-semibold">Appearance</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground mt-0.5">
                Customize how AnonChat looks for you.
              </Dialog.Description>
            </div>
            <Dialog.Close className="mt-0.5 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium mb-2.5">Mode</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm transition-all",
                    theme === "light"
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <Sun className="h-4 w-4 shrink-0" />
                  Light
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm transition-all",
                    theme === "dark"
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <Moon className="h-4 w-4 shrink-0" />
                  Dark
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2.5">Color Theme</h3>
              <div className="flex flex-col gap-2">
                {themes.map((colorTheme) => {
                  const isActive = colorThemeId === colorTheme.id;
                  return (
                    <button
                      key={colorTheme.id}
                      onClick={() => setColorTheme(colorTheme.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all text-left",
                        isActive
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:bg-muted/40"
                      )}
                    >
                      <div className="flex gap-1 shrink-0">
                        <span
                          className="w-4 h-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: colorTheme.preview.primary }}
                        />
                        <span
                          className="w-4 h-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: colorTheme.preview.secondary }}
                        />
                        <span
                          className="w-4 h-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: colorTheme.preview.accent }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm leading-none", isActive ? "text-foreground font-medium" : "text-foreground/80")}>
                          {colorTheme.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{colorTheme.description}</p>
                      </div>
                      <span
                        className={cn(
                          "ml-auto shrink-0 h-4 w-4 rounded-full border-2 transition-all",
                          isActive
                            ? "border-primary bg-primary"
                            : "border-border/60 bg-transparent"
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
