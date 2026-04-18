import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSupportLanguageLabel,
  isSupportedSupportLanguage,
} from "@/lib/translation/languages";

const ROLE_LABELS = {
  customer: "Customer",
  support: "Support",
  internal: "Internal",
};

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function roleLabel(role) {
  return ROLE_LABELS[String(role || "").toLowerCase()] || "Message";
}

export function TranslationModal({ open, onOpenChange, threadId, translationData }) {
  const loading = translationData?.loading ?? false;
  const conversationItems = Array.isArray(translationData?.items) ? translationData.items : [];
  const translatedDraftText = asString(translationData?.draft?.translatedText);
  const error = (!loading && translationData !== null && conversationItems.length === 0 && !translatedDraftText) ? "Could not load translation." : "";

  const targetLabel = useMemo(() => {
    const code = asString(conversationItems[0]?.originalLanguage || "en");
    return getSupportLanguageLabel(code);
  }, [conversationItems]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[100vw] max-w-4xl overflow-hidden border-slate-200 bg-white p-0">
        <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-6">
          <DialogTitle className="text-xl font-semibold text-slate-900">Translation</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Translated to {targetLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-7 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
              <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm text-slate-700">Could not load translation.</p>
            </div>
          ) : null}

          {!loading && !error ? (
            <>
              <section className="space-y-3">
                <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
                  Conversation
                </h3>
                {conversationItems.length ? (
                  <div className="space-y-2">
                    {conversationItems.map((item, index) => {
                      const originalLanguage = asString(item?.originalLanguage).toLowerCase();
                      const originalLanguageLabel = isSupportedSupportLanguage(originalLanguage)
                        ? getSupportLanguageLabel(originalLanguage)
                        : originalLanguage.toUpperCase();
                      return (
                        <article
                          key={String(item?.id || `conversation-item-${index}`)}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-3"
                        >
                          <div className="mb-1.5 flex items-center gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              {roleLabel(item?.role)}
                            </p>
                            {originalLanguage ? (
                              <span className="text-xs text-slate-400">
                                Translated from {originalLanguageLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                            {asString(item?.translatedText)}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No conversation available to translate.</p>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
                  Draft reply
                </h3>
                {translatedDraftText ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                      {translatedDraftText}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No draft available to translate.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
