import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
      <SignUp path="/sign-up" routing="path" afterSignUpUrl="/onboarding" />
    </div>
  );
}
