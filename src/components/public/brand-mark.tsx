import { themeString } from "@/lib/theme";
import type { PublicBusiness } from "@/lib/types";
import { cn } from "@/components/ui/cn";

/** Wordmark if the business has one, otherwise the name set in the display face. */
export function BrandMark({ business, className }: { business: Pick<PublicBusiness, "name" | "theme">; className?: string }) {
  const wordmark = themeString(business.theme, "wordmark_url");
  if (wordmark) {
    return (
      <span
        role="img"
        aria-label={business.name}
        className={cn("block bg-current", className)}
        style={{
          WebkitMaskImage: `url(${wordmark})`,
          maskImage: `url(${wordmark})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "left center",
          maskPosition: "left center",
          aspectRatio: "672 / 161",
        }}
      />
    );
  }
  return <span className={cn("display block text-2xl font-semibold tracking-[0.08em]", className)}>{business.name}</span>;
}
