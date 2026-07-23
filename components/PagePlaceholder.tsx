import type { ReactNode } from "react";

interface PagePlaceholderProps {
  title: string;
  children?: ReactNode;
}

/**
 * Lightweight stand-in for pages whose bodies are built in later phases.
 * Keeps the nav links from 404-ing so the shell is navigable end to end.
 */
export function PagePlaceholder({ title, children }: PagePlaceholderProps) {
  return (
    <section className="page-placeholder">
      <h1>{title}</h1>
      {children ?? <p>Coming soon.</p>}
    </section>
  );
}
