// Adapted from shadcn/ui's Mode Toggle and Base UI dropdown-menu patterns (MIT).
// See docs/shadcn-license.txt. Semantic tokens preserve the wiki's pre-paint theme.
import React, { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
const choices = { light: "Light", dark: "Dark", system: "System" };
function ThemeIcon({ mode, className }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </>
      ) : mode === "dark" ? (
        <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </>
      )}
    </svg>
  );
}
function applyTheme(value) {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
}
export function ModeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "system",
  );
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== "wiki-appearance" && event.key !== null) return;
      const value = ["light", "dark"].includes(event.newValue)
        ? event.newValue
        : "system";
      applyTheme(value);
      setTheme(value);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function choose(value) {
    applyTheme(value);
    setTheme(value);
    try {
      localStorage.setItem("wiki-appearance", value);
    } catch {
      /* Optional storage. */
    }
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        className="account-trigger mode-toggle"
        aria-label="Toggle theme"
        title={`Theme: ${choices[theme]}`}
      >
        <ThemeIcon mode="light" className="theme-sun" />
        <ThemeIcon mode="dark" className="theme-moon" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="account-positioner"
        >
          <Menu.Popup className="account-popup theme-popup">
            <Menu.RadioGroup
              value={theme}
              onValueChange={choose}
              aria-label="Appearance"
            >
              {Object.entries(choices).map(([value, label]) => (
                <Menu.RadioItem
                  className="account-menu-item theme-option"
                  key={value}
                  value={value}
                  closeOnClick
                >
                  <ThemeIcon mode={value} />
                  <span>{label}</span>
                  <Menu.RadioItemIndicator
                    className="theme-check"
                    aria-hidden="true"
                  >
                    ✓
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
