import Image from "next/image";

export function BeaconMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="BEACON">
      <Image
        className="brand-logo-image"
        src="/beacon-logo.png"
        alt=""
        width={48}
        height={48}
        priority
      />
      {!compact && (
        <span>
          BEACON<small>Command centre</small>
        </span>
      )}
    </div>
  );
}
