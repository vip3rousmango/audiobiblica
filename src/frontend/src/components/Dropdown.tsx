import React, { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';

interface DropdownItem {
  label: string;
  onClick: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
}

export const Dropdown: React.FC<DropdownProps> = ({ trigger, items, align = 'end' }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current.find((item) => item && !item.disabled)?.focus();
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const enabledIndices = items.reduce<number[]>((indices, item, index) => {
      if (!item.disabled) indices.push(index);
      return indices;
    }, []);
    if (enabledIndices.length === 0) return;
    event.preventDefault();
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const position = enabledIndices.indexOf(activeIndex);
    if (event.key === 'Home') {
      itemRefs.current[enabledIndices[0]]?.focus();
    } else if (event.key === 'End') {
      itemRefs.current[enabledIndices[enabledIndices.length - 1]]?.focus();
    } else {
      const current = position < 0 ? (event.key === 'ArrowDown' ? -1 : 0) : position;
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + offset + enabledIndices.length) % enabledIndices.length;
      itemRefs.current[enabledIndices[next]]?.focus();
    }
  };

  const handleTriggerClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setOpen((prev) => !prev);
  };

  return (
    <div className="dropdown" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        onClick={handleTriggerClick}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open menu"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`dropdown-menu ${align === 'end' ? 'dropdown-menu-end' : ''}`}
          role="menu"
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={index}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className={`dropdown-item ${item.danger ? 'dropdown-item-danger' : ''} ${item.disabled ? 'dropdown-item-disabled' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
                setOpen(false);
                triggerRef.current?.focus();
              }}
              disabled={item.disabled}
            >
              {item.icon && <Icon name={item.icon} size={14} className="dropdown-item-icon" />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};