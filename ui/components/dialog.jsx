// Adapted from shadcn/ui base-nova dialog (MIT); see docs/shadcn-license.txt.
// Semantic CSS replaces Tailwind utilities; Base UI retains focus and dismissal.
import React from "react";
import { Dialog as Primitive } from "@base-ui/react/dialog";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  children,
  className = "",
  closeLabel = "Close search",
}) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="ui-overlay" />
      <Primitive.Popup className={`ui-dialog ${className}`}>
        {children}
        <Primitive.Close className="ui-close" aria-label={closeLabel}>
          ×
        </Primitive.Close>
      </Primitive.Popup>
    </Primitive.Portal>
  );
}
