import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "defaultChecked" | "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, defaultChecked, onCheckedChange, onChange, disabled, ...props }, ref) => {
    const [internalChecked, setInternalChecked] = React.useState(!!defaultChecked);
    const isControlled = checked !== undefined;
    const isChecked = isControlled ? !!checked : internalChecked;

    return (
      <input
        ref={ref}
        type="checkbox"
        role="checkbox"
        aria-checked={isChecked}
        checked={isChecked}
        disabled={disabled}
        data-state={isChecked ? "checked" : "unchecked"}
        onChange={(event) => {
          const next = event.target.checked;
          if (!isControlled) setInternalChecked(next);
          onCheckedChange?.(next);
          onChange?.(event);
        }}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded border border-primary bg-background accent-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

Checkbox.displayName = "Checkbox";

export { Checkbox };