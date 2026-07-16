import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  '[data-update-modal-initial-focus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UpdateModalProps {
  titleId: string;
  descriptionId?: string;
  onClose: () => void;
  className: string;
  children: React.ReactNode;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  titleId,
  descriptionId,
  onClose,
  className,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const dialog = dialogRef.current;
    const initialFocus = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialFocus ?? dialog)?.focus();

    return () => {
      if (previousActiveElement.current?.isConnected) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === focusable[0] || !dialog.contains(activeElement))) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (!event.shiftKey && activeElement === focusable[focusable.length - 1]) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60000] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={className}
      >
        {children}
      </div>
    </div>
  );
};
