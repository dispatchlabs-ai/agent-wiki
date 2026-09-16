// Read the explicit preference before paint; system appearance needs no JS.
try {
  const theme = localStorage.getItem("wiki-appearance");
  if (["light", "dark"].includes(theme))
    document.documentElement.dataset.theme = theme;
} catch {
  /* Storage may be disabled. */
}
