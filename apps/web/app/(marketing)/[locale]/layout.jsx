import { NextIntlClientProvider } from "next-intl";
import { getMessages, unstable_setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Marketing-gruppen: leverer messages til client-øer. Root-layoutet ejer <html>.
export default async function MarketingLayout({ children, params: { locale } }) {
  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
