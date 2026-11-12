import type { ReactNode } from 'react';

// Ancienne interface (legacy.css), pour les pages pas encore redessinées ou non dessinées
export function Legacy({ children }: { children: ReactNode }) {
  return <div className="legacy">{children}</div>;
}
