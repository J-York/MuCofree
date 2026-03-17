type AvatarSize = "sm" | "md" | "lg" | "xl";

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
  className?: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2);
}

const sizeMap: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 64, xl: 80 };
const fontMap: Record<AvatarSize, number> = { sm: 12, md: 15, lg: 22, xl: 26 };

export default function Avatar({ name, avatarUrl, size = "md", className = "" }: Props) {
  const px = sizeMap[size];
  const fs = fontMap[size];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={px}
        height={px}
        className={`avatar avatar-${size} ${className}`}
      />
    );
  }

  // Deterministic colour from name
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className={`avatar avatar-${size} ${className}`}
      style={{
        width: px,
        height: px,
        background: `hsl(${hue}, 38%, 62%)`,
        border: "2px solid rgba(255,255,255,0.4)",
        display: "grid",
        placeItems: "center",
        color: "white",
        fontWeight: 700,
        fontSize: fs,
        fontFamily: "var(--font-serif)",
        userSelect: "none"
      }}
    >
      {initials(name)}
    </div>
  );
}
