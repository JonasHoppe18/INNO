export default function FooterSection() {
  return (
    <footer className="border-t border-white/10 py-12">
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex flex-col items-center">
          <p className="text-sm text-slate-400">
            © {new Date().getFullYear()} Sona. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
