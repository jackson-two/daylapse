import type { ReactNode } from "react";

/** Keep the label and explanation beside the editable example. */
export function FormField({ id, label, description, children }: {
  id: string;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <div className="form-field__copy">
        <label htmlFor={id}>{label}</label>
        <p id={`${id}-hint`}>{description}</p>
      </div>
      <div className="form-field__control">{children}</div>
    </div>
  );
}
