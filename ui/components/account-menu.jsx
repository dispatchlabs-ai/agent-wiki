import React, { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";

export function AccountMenu() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setUser)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!user) return null;
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wiki-CSRF": user.csrf,
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("Please try signing out again.");
      location.href = "/";
    } catch {
      setError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }
  return (
    <Menu.Root>
      <Menu.Trigger className="account-trigger" aria-label="Account menu">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="account-positioner"
        >
          <Menu.Popup className="account-popup">
            <Menu.Group>
              <Menu.GroupLabel className="account-identity">
                <strong>{user.name}</strong>
                <span>{user.role || "No space access"}</span>
              </Menu.GroupLabel>
              <Menu.LinkItem href="/account/" className="account-menu-item">
                Your account
              </Menu.LinkItem>
              {user.role === "manager" && (
                <Menu.LinkItem href="/access/" className="account-menu-item">
                  Manage access
                </Menu.LinkItem>
              )}
              <Menu.Separator className="account-separator" />
              <Menu.Item
                className="account-menu-item"
                closeOnClick={false}
                disabled={busy}
                onClick={signOut}
              >
                {busy ? "Signing out…" : "Sign out"}
              </Menu.Item>
            </Menu.Group>
            {error && (
              <p role="alert" className="account-error">
                {error}
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
