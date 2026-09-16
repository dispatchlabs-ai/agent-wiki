import React, { useState, useEffect } from "react";
import { SearchForm, SearchIcon } from "./search.mjs";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog.jsx";
export function QuickSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="quick-search-trigger" aria-label="Search">
        <span className="search-trigger-label">
          <SearchIcon />
          <span className="search-trigger-text">Search</span>
        </span>
        <kbd aria-hidden="true">⌘ / Ctrl K</kbd>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Search your knowledge</DialogTitle>
        <DialogDescription>
          Find articles and the conversations behind them.
        </DialogDescription>
        <SearchForm id="dialog-query" required />
        <nav aria-label="Quick navigation">
          <a href="/wiki/">Browse articles</a>
          <a href="/traces/">Explore conversations</a>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
