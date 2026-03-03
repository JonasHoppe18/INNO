import Link from "next/link";
import { SonaLogo } from "@/components/ui/SonaLogo";

export default function OnboardingLayout({ children }) {
  return (
    <div className="relative flex h-screen w-full items-center justify-center bg-white px-6 py-10">
      <Link
        href="/"
        className="absolute left-6 top-6 inline-flex items-center gap-2 text-inherit no-underline"
      >
        <SonaLogo size={24} className="h-4 w-4" />
        <span className="text-base font-semibold text-slate-700">Sona AI</span>
      </Link>
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}
