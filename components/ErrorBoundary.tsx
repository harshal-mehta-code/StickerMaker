"use client";

import { Component, ReactNode } from "react";
import { Button } from "./ui";

/**
 * Catches render-time crashes so a single bad photo can't leave the page blank.
 * A browser that runs out of memory kills the tab outright and never gets here,
 * which is why the pipeline works hard to stay under the limit in the first
 * place.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Sticker Studio crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md rounded-[1.75rem] border-2 border-coral/40 bg-paper p-6 text-center">
        <p className="text-4xl" aria-hidden>
          🙀
        </p>
        <h2 className="mt-2 font-display text-xl font-extrabold text-ink">That didn&apos;t go to plan</h2>
        <p className="mt-1 text-xs font-semibold text-ink-soft">{this.state.error.message}</p>
        <div className="mt-4">
          <Button onClick={() => window.location.reload()}>Start over</Button>
        </div>
      </div>
    );
  }
}
