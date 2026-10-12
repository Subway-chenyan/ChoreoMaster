import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function MobileSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="mobile-sheet-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeRef.current();
          }
          if (event.key !== 'Tab') return;
          const nodes = [
            ...(panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, [tabindex="0"]'
            ) ?? []),
          ];
          const first = nodes[0];
          const last = nodes.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="mobile-sheet__handle" />
        <header>
          <h2>{title}</h2>
          <button type="button" className="mobile-icon" aria-label="关闭面板" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </div>
  );
}
