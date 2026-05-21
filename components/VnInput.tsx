"use client";

/**
 * VnInput / VnTextarea — input chống lỗi IME tiếng Việt
 *
 * Vấn đề: React controlled input + IME composition (gõ dấu Tiếng Việt) đôi khi
 * bị mất ký tự space hoặc dấu khi parent re-render giữa lúc composition.
 *
 * Giải pháp: Defer state update trong lúc composition. Chỉ sync state KHI composition
 * kết thúc (onCompositionEnd) — và normal onChange khi không composition.
 *
 * Dùng giống <input> hoặc <textarea> bình thường, chỉ thay value/onChange signature:
 *   value: string
 *   onValueChange: (v: string) => void
 */

import { forwardRef, useRef, useEffect } from "react";

type VnInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
};

export const VnInput = forwardRef<HTMLInputElement, VnInputProps>(function VnInput(
  { value, onValueChange, onCompositionStart, onCompositionEnd, ...rest },
  ref
) {
  const composingRef = useRef(false);
  const innerRef = useRef<HTMLInputElement | null>(null);

  // Cho phép ref ngoài + ref nội bộ
  const setRef = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  // Đồng bộ DOM value khi prop value đổi từ ngoài (NHƯNG không can thiệp lúc composition)
  useEffect(() => {
    if (!composingRef.current && innerRef.current && innerRef.current.value !== value) {
      innerRef.current.value = value;
    }
  }, [value]);

  return (
    <input
      {...rest}
      ref={setRef}
      defaultValue={value}
      onCompositionStart={(e) => {
        composingRef.current = true;
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const v = (e.target as HTMLInputElement).value;
        onValueChange(v);
        onCompositionEnd?.(e);
      }}
      onChange={(e) => {
        if (!composingRef.current) {
          onValueChange(e.target.value);
        }
      }}
    />
  );
});

type VnTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
};

export const VnTextarea = forwardRef<HTMLTextAreaElement, VnTextareaProps>(function VnTextarea(
  { value, onValueChange, onCompositionStart, onCompositionEnd, ...rest },
  ref
) {
  const composingRef = useRef(false);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  useEffect(() => {
    if (!composingRef.current && innerRef.current && innerRef.current.value !== value) {
      innerRef.current.value = value;
    }
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={setRef}
      defaultValue={value}
      onCompositionStart={(e) => {
        composingRef.current = true;
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const v = (e.target as HTMLTextAreaElement).value;
        onValueChange(v);
        onCompositionEnd?.(e);
      }}
      onChange={(e) => {
        if (!composingRef.current) {
          onValueChange(e.target.value);
        }
      }}
    />
  );
});
