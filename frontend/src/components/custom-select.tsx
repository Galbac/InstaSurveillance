"use client";

import { useEffect, useRef, useState, isValidElement } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
}

export interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  icon?: React.ReactNode | React.ComponentType<{ size?: number; className?: string }>;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  fullWidth?: boolean;
}

export function CustomSelect({
  value,
  onChange,
  options,
  icon,
  ariaLabel,
  className = "",
  placeholder = "Выберите...",
  fullWidth = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [open]);

  const renderIcon = () => {
    if (!icon) return null;
    if (isValidElement(icon)) {
      return (
        <span className="control-icon" style={{ display: "inline-flex", alignItems: "center" }}>
          {icon}
        </span>
      );
    }
    const IconComp = icon as React.ComponentType<{ size?: number; className?: string }>;
    return <IconComp size={14} className="control-icon" />;
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${fullWidth ? "full-width" : ""} ${
        open ? "is-open" : ""
      } ${className}`}
    >
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {renderIcon()}
        <span className="custom-select-label">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`chevron-icon ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="custom-select-dropdown" role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`custom-select-option ${isSelected ? "active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={14} className="check-icon" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
export default CustomSelect;
