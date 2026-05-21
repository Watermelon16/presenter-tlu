import Link from "next/link";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  size?: Size;
  showText?: boolean;
  href?: string | null;       // null = không bọc Link
  textTone?: "dark" | "light";
  className?: string;
}

const ICON_PX: Record<Size, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 56,
  xl: 80,
};

const TEXT_CLASSES: Record<Size, string> = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-4xl",
};

const GAP_CLASSES: Record<Size, string> = {
  xs: "gap-1.5",
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
  xl: "gap-4",
};

/**
 * Logo "Presenter TLU" — monogram PT trong square zinc-900 + chấm emerald accent.
 *
 * Mặc định clickable về `/`. `href={null}` để không bọc Link.
 * `showText={false}` để chỉ hiện icon (mobile / favicon).
 */
export function Logo({
  size = "md",
  showText = true,
  href = "/",
  textTone = "dark",
  className = "",
}: Props) {
  const px = ICON_PX[size];

  const content = (
    <span className={`inline-flex items-center ${GAP_CLASSES[size]} ${className}`}>
      <svg
        viewBox="0 0 64 64"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect x="0" y="0" width="64" height="64" rx="14" fill="#18181b" />
        <text
          x="32"
          y="43"
          fontFamily="Inter, system-ui, -apple-system, sans-serif"
          fontSize="28"
          fontWeight="800"
          fill="white"
          textAnchor="middle"
          letterSpacing="-1.5"
        >
          PT
        </text>
        <circle cx="51" cy="13" r="3" fill="#10b981" />
      </svg>

      {showText && (
        <span
          className={`font-semibold tracking-tight leading-none ${TEXT_CLASSES[size]} ${
            textTone === "light" ? "text-white" : "text-zinc-900"
          }`}
        >
          Presenter
          <span
            className={textTone === "light" ? "text-emerald-300 ml-1" : "text-emerald-600 ml-1"}
          >
            TLU
          </span>
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center hover:opacity-80 transition-opacity"
        aria-label="Presenter TLU — về trang chủ"
      >
        {content}
      </Link>
    );
  }
  return content;
}
