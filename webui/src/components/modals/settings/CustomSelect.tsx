import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface CustomSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Seleziona...',
  className = '',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDownGlobal = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDownGlobal);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDownGlobal);
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`relative w-full ${className}`}
    >
      {/* Hidden Native Select for DOM testing & accessibility */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {!options.some(o => o.value === value) && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-default)] hover:border-[var(--accent-bg)] text-left text-sm font-medium transition-all duration-180 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate text-sm text-[var(--text-primary)]">
          {selectedOption ? (
            <>
              {selectedOption.label}
              {selectedOption.sublabel && (
                <span className="text-xs text-[var(--text-muted)] font-normal ml-1.5 opacity-80">
                  ({selectedOption.sublabel})
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--text-muted)] font-normal">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-muted)] shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[var(--accent-text)]' : ''
          }`}
        />
      </button>

      {/* Menu Overlay */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-xl shadow-black/25 overflow-hidden py-1 max-h-60 overflow-y-auto app-scroll"
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                onClick={() => {
                  if (!opt.disabled) {
                    onChange(opt.value);
                    setIsOpen(false);
                  }
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm text-left transition-colors ${
                  opt.disabled
                    ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                    : isSelected
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)] font-semibold'
                    : 'text-[var(--text-primary)] hover:bg-[var(--sidebar-active-bg)]'
                }`}
              >
                <div className="truncate pr-2">
                  <span>{opt.label}</span>
                  {opt.sublabel && (
                    <span className="text-xs text-[var(--text-muted)] font-normal ml-1.5 opacity-80">
                      ({opt.sublabel})
                    </span>
                  )}
                </div>
                {isSelected && <Check className="w-4 h-4 text-[var(--accent-text)] shrink-0 ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
