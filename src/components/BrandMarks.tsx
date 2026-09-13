import type { ReactNode } from "react";

export type PartnerBrand = "eventbrite" | "discord" | "github";

const SIZE = { sm: 14, md: 16, lg: 22 } as const;

function MarkWrap({
  label,
  size,
  children,
}: {
  label: string;
  size: keyof typeof SIZE;
  children: ReactNode;
}) {
  const px = SIZE[size];
  return (
    <span className="brand-mark" title={label} aria-label={label} role="img">
      <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden>
        {children}
      </svg>
    </span>
  );
}

export function BrandMark({ brand, size = "md" }: { brand: PartnerBrand; size?: keyof typeof SIZE }) {
  if (brand === "eventbrite") {
    return (
      <MarkWrap label="Eventbrite" size={size}>
        <circle cx="12" cy="12" r="12" fill="#F05537" />
        <text
          x="12"
          y="16.6"
          textAnchor="middle"
          fill="#fff"
          fontSize="13.5"
          fontWeight="700"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          e
        </text>
      </MarkWrap>
    );
  }
  if (brand === "discord") {
    return (
      <MarkWrap label="Discord" size={size}>
        <circle cx="12" cy="12" r="12" fill="#5865F2" />
        <path
          fill="#fff"
          d="M16.36 7.64a10.4 10.4 0 0 0-2.56-.79.4.4 0 0 0-.42.2c-.17.31-.36.71-.5 1.03a9.6 9.6 0 0 0-2.87 0 7.3 7.3 0 0 0-.51-1.03.41.41 0 0 0-.42-.2 10.36 10.36 0 0 0-2.56.79.36.36 0 0 0-.17.15C5.07 10.09 4.63 12.47 4.85 14.82c0 .07.04.14.1.18a10.5 10.5 0 0 0 3.14 1.59.4.4 0 0 0 .44-.15c.34-.46.65-.95.91-1.46a.4.4 0 0 0-.22-.55 7.5 7.5 0 0 1-.98-.47.4.4 0 0 1-.04-.67c.07-.05.13-.1.2-.15a.39.39 0 0 1 .4-.03c2.06.94 4.29.94 6.32 0a.39.39 0 0 1 .41.03c.07.05.13.1.2.15a.4.4 0 0 1-.04.67c-.3.18-.63.34-.98.47a.4.4 0 0 0-.22.55c.26.51.57 1 .91 1.46a.4.4 0 0 0 .44.15 10.45 10.45 0 0 0 3.15-1.59.4.4 0 0 0 .1-.18c.26-2.75-.44-5.1-1.86-7.03a.32.32 0 0 0-.16-.15ZM10.1 13.4c-.62 0-1.13-.57-1.13-1.27s.5-1.27 1.13-1.27 1.14.57 1.13 1.27-.5 1.27-1.13 1.27Zm3.8 0c-.62 0-1.13-.57-1.13-1.27s.5-1.27 1.13-1.27 1.14.57 1.13 1.27-.5 1.27-1.13 1.27Z"
        />
      </MarkWrap>
    );
  }
  return (
    <MarkWrap label="GitHub" size={size}>
      <circle cx="12" cy="12" r="12" fill="#181717" />
      <path
        fill="#fff"
        d="M12 5.1c-3.86 0-7 3.14-7 7 0 3.09 2 5.71 4.78 6.64.35.06.48-.15.48-.34 0-.16 0-.7 0-1.37-1.76.32-2.14-.74-2.27-1.42-.08-.2-.42-.82-.72-.99-.24-.13-.6-.45 0-.46.55 0 .95.5 1.08.72.63 1.06 1.64.76 2.04.58.06-.45.24-.76.44-.93-1.56-.18-3.19-.78-3.19-3.46 0-.76.27-1.39.72-1.88-.07-.18-.31-.89.07-1.85 0 0 .59-.19 1.93.72A6.7 6.7 0 0 1 12 8.5c.62 0 1.24.08 1.82.24 1.34-.91 1.93-.72 1.93-.72.38.96.14 1.67.07 1.85.45.49.72 1.12.72 1.88 0 2.69-1.64 3.28-3.2 3.46.25.22.47.64.47 1.3 0 .93 0 1.68 0 1.91 0 .19.13.41.48.34A7.02 7.02 0 0 0 19 12.1c0-3.86-3.14-7-7-7Z"
      />
    </MarkWrap>
  );
}

export function brandForAgent(agent: string): PartnerBrand | undefined {
  if (agent === "registration") return "eventbrite";
  if (agent === "progress") return "github";
  if (agent === "community") return "discord";
  return undefined;
}

export function brandForChecklist(id: string): PartnerBrand | undefined {
  if (["eventCreated", "ticketCreated", "attendeesSynced", "emailsSent"].includes(id)) return "eventbrite";
  if (["discordSetup", "discordOnboarded", "teamChannelsCreated"].includes(id)) return "discord";
  if (["githubReposCreated", "githubScanned", "judged"].includes(id)) return "github";
  return undefined;
}

