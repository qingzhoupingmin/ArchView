import { create } from 'zustand';

export type ToastKind = 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // 反馈规范（产品文档 §10.3）：成功 2s / 错误 5s
    setTimeout(() => {
      useToastStore.getState().dismiss(id);
    }, kind === 'success' ? 2000 : 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toastSuccess(text: string): void {
  useToastStore.getState().push('success', text);
}

export function toastError(text: string): void {
  useToastStore.getState().push('error', text);
}
