import { createContext, useContext } from "react";

export const ToastContext = createContext(null);

// toast({ title, description, tone: "success" | "error" | "info", duration })
// Outside a ToastProvider (some tests) it is a no-op, so components never crash.
export function useToast() {
  return useContext(ToastContext) ?? (() => {});
}
