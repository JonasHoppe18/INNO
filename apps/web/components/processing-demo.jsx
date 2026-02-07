"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Truck, Mail } from "lucide-react";
import Image from "next/image";
import shopifyLogo from "../../../assets/Shopify-Logo.png";
import { SonaLogo } from "@/components/ui/SonaLogo";

const StepCard = ({ icon, title, subtext, status, statusIcon, tone = "sky", active, done }) => {
  const toneColor =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "purple"
      ? "text-indigo-200"
      : "text-sky-200";

  const statusBg = done || active ? "bg-white/10 text-white" : "bg-white/5 text-slate-300";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="flex w-full flex-col items-start justify-between gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/80 px-5 py-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-base text-white">{title}</span>
          <span className="text-xs text-slate-400">{subtext}</span>
        </div>
      </div>
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusBg} ${toneColor}`}
      >
        <span>{status}</span>
        {done && statusIcon ? <span>{statusIcon}</span> : null}
        {active && !done && !statusIcon ? (
          <span className="flex h-2 w-2">
            <span className="m-auto h-2 w-2 animate-ping rounded-full bg-white/70" />
          </span>
        ) : null}
      </div>
    </motion.div>
  );
};

export default function ProcessingDemo() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      key: "get_order",
      icon: (
        <Image
          src={shopifyLogo}
          alt="Shopify logo"
          width={54}
          height={54}
          className="object-contain"
        />
      ),
      title: "get_order",
      subtext: "Shopify API - #3259",
      status: "Found",
      statusIcon: null,
      tone: "emerald",
    },
    {
      key: "check_tracking",
      icon: <Truck className="h-5 w-5 text-sky-200" />,
      title: "check_tracking",
      subtext: "GLS",
      status: "In Transit",
      statusIcon: null,
      tone: "sky",
    },
    {
      key: "generate_draft",
      icon: <SonaLogo size={34} />,
      title: "generate_draft",
      subtext: "Sona AI",
      status: "Writing...",
      statusIcon: null,
      tone: "purple",
    },
  ];

  const totalSteps = steps.length + 1; // extra tick for draft reveal

  useEffect(() => {
    const stepIntervals = [2200, 1600, 2000, 1200];
    if (activeStep >= totalSteps - 1) {
      return;
    }
    const timer = setTimeout(() => {
      setActiveStep((prev) => prev + 1);
    }, stepIntervals[activeStep % stepIntervals.length]);

    return () => clearTimeout(timer);
  }, [activeStep, totalSteps]);

  return (
    <div className="relative min-h-[360px] w-full max-w-[620px] p-2 sm:min-h-[420px]">
      <div className="flex h-full w-full flex-col space-y-4">
        <motion.div
          key="ticket"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/80 p-5 shadow-sm backdrop-blur"
        >
          <div className="mb-2 flex items-center">
            <span className="font-semibold text-card-foreground">Lars</span>
          </div>
          <p className="text-card-foreground">Where is my order #3259?</p>
        </motion.div>

        <div className="flex-grow space-y-4">
          <AnimatePresence>
            {steps.map((step, idx) =>
              activeStep > idx ? (
                <StepCard
                  key={step.key}
                  icon={step.icon}
                  title={step.title}
                  subtext={step.subtext}
                  status={step.status}
                  statusIcon={step.statusIcon}
                  tone={step.tone}
                  active={activeStep === idx + 1}
                  done={activeStep > idx + 1}
                />
              ) : null
            )}
          </AnimatePresence>

          {activeStep < steps.length && (
            <div className="w-full rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200/80 backdrop-blur">
              <div className="flex items-center gap-2">
                <div className="flex h-2 w-2 animate-ping rounded-full bg-sky-400" />
                <span>Working on the next step...</span>
              </div>
            </div>
          )}
        </div>

        <AnimatePresence>
          {activeStep >= steps.length && (
            <motion.div
              key="draft"
              initial={{ opacity: 0, y: 20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              transition={{ duration: 0.5, type: "spring" }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.3 } }}
              className="w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/80 p-5 shadow-lg"
            >
              <div className="mb-3 flex items-center">
                <Mail className="mr-3 h-5 w-5 text-muted-foreground" />
                <span className="font-semibold text-card-foreground">Reply to Lars (Draft)</span>
              </div>
              <div className="space-y-2 text-sm text-card-foreground">
                <p>Hi Lars,</p>
                <p>Thanks for reaching out!</p>
                <p>
                  I can see that your order #3259 has shipped and is on its way with GLS. You can
                  track it with this tracking number:{" "}
                  <span className="font-mono text-blue-600">373461234567</span>.
                </p>
                <p>Expected delivery within 2-3 business days.</p>
                <p>
                  Best regards,
                  <br />
                  Jonas
                  <br />
                  Customer Support
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
