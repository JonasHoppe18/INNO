import { recordCsatResponse } from "@/lib/server/csat-response";
import { createCsatServiceClient } from "@/lib/server/csat-route";

export const dynamic = "force-dynamic";

function responseCopy(reason) {
  if (reason === "invalid_score") return "That rating is not valid.";
  if (reason === "expired_token") return "This feedback link has expired.";
  if (reason === "missing_token") return "This feedback link is incomplete.";
  return "This feedback link is no longer available.";
}

export default async function CsatResponsePage({ params, searchParams }) {
  const serviceClient = createCsatServiceClient();
  const score = Number(searchParams?.score);
  const result = serviceClient
    ? await recordCsatResponse(serviceClient, { token: params?.token, score })
    : { ok: false, reason: "invalid_token" };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600">
          {result.ok ? "✓" : "!"}
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {result.workspaceName || "Sona"}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
          {result.ok ? result.group?.heading : "We could not record that rating"}
        </h1>
        <p className="mx-auto mt-4 max-w-md whitespace-pre-line text-sm leading-6 text-slate-600">
          {result.ok ? result.group?.body : responseCopy(result.reason)}
        </p>
        {result.ok && result.group?.button_text && result.group?.button_url ? (
          <a
            href={result.group.button_url}
            className="mt-7 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {result.group.button_text}
          </a>
        ) : null}
      </section>
    </main>
  );
}
