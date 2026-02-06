import Image from "next/image";
import shopifyLogo from "../../../assets/Shopify-Logo.png";
import gmailLogo from "../../../assets/Gmail-logo.webp";
import outlookLogo from "../../../assets/Outlook-logo.png";

const logos = [
  {
    name: "Shopify",
    src: shopifyLogo,
    scale: "scale-150",
  },
  {
    name: "Gmail",
    src: gmailLogo,
    scale: "scale-115",
  },
  {
    name: "Outlook",
    src: outlookLogo,
    scale: "scale-100",
  },
];

export default function TrustLogos() {
  return (
    <section className="border-y border-white/5 bg-slate-900/30">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-slate-500">
          Works seamlessly with the platforms you trust
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-12 md:gap-16">
          {logos.map((logo) => (
            <div
              key={logo.name}
              className="flex items-center gap-3 text-slate-500 opacity-60 transition-all duration-300 hover:text-white hover:opacity-100"
              aria-label={logo.name}
            >
              <div className="flex h-10 w-10 items-center justify-center">
                {logo.src ? (
                  <Image
                    src={logo.src}
                    alt={logo.name}
                    width={120}
                    height={32}
                    className={`h-8 w-auto object-contain grayscale ${logo.scale ?? ""}`}
                  />
                ) : (
                  <span className="h-8 w-8 text-inherit">{logo.svg}</span>
                )}
              </div>
              <span className="text-sm font-medium">{logo.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
