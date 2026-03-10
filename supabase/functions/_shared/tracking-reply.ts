import type { TrackingDetail, TrackingSnapshot } from "./tracking.ts";

type SupportedLocale = "da" | "en" | "sv" | "de";
type ReplyStatus =
  | "DELIVERED"
  | "DELIVEREDPS"
  | "INDELIVERY"
  | "INTRANSIT"
  | "NOTDELIVERED"
  | "PREADVICE"
  | "UNKNOWN";

export type TrackingReplyInput = {
  locale: string;
  customerFirstName?: string | null;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status?: string | null;
  statusDateTime?: string | null;
  latestEventDescription?: string | null;
  latestEventCode?: string | null;
  deliveredToParcelShop?: boolean;
  parcelShopName?: string | null;
  parcelShopAddressLine?: string | null;
  parcelShopPostalCode?: string | null;
  parcelShopCity?: string | null;
};

type ReplyCopy = {
  greeting: (name: string) => string;
  fallbackNoTracking: string[];
  statusLead: Record<ReplyStatus, string[]>;
  statusDetail: {
    deliveredAt: string;
    inDeliveryEta: string;
    inDeliveryScan: string;
    inTransitLatest: string;
    notDeliveredLatest: string;
    preAdviceLatest: string;
  };
  parcelShopLine: {
    generic: string;
    withName: string;
    withAddress: string;
  };
  trackingLine: string;
  linkLine: string;
  reassuranceByStatus: Record<ReplyStatus, string[]>;
  signoff: string;
};

const OPENAI_API_KEY = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
const OPENAI_MODEL = (Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini").trim();
const TRACKING_REPLY_USE_OPENAI = (Deno.env.get("TRACKING_REPLY_USE_OPENAI") ?? "").trim() === "true";

export const detectTrackingIntent = (subject: string, body: string) => {
  const input = `${subject || ""}\n${body || ""}`.toLowerCase();
  const hints = [
    "hvor er min ordre",
    "status på ordre",
    "tracking",
    "track and trace",
    "where is my order",
    "where's my order",
    "when will i receive",
    "delivery status",
    "not received",
    "out for delivery",
    "delivered but not received",
    "hvornår modtager jeg",
    "ikke modtaget",
    "leveret men ikke modtaget",
    "var är min beställning",
    "wo ist meine bestellung",
  ];
  if (hints.some((hint) => input.includes(hint))) return true;
  return /(receive|delivery|track)\s+my\s+order/i.test(input);
};

export const pickOrderTrackingKey = (order: any): string | null =>
  (order?.id ? String(order.id) : null) ||
  (order?.order_number ? String(order.order_number) : null) ||
  (order?.name ? String(order.name) : null);

function hashString(value: string): number {
  let hash = 0;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickVariant(seed: number, variants: string[]): string {
  if (!variants.length) return "";
  return variants[Math.abs(seed) % variants.length];
}

function detectReplyLocale(input: string): SupportedLocale {
  const text = String(input || "").toLowerCase();
  const daHints = ["hej", "tak", "ordre", "pakken", "leveret", "hvor er min ordre"];
  const enHints = ["hi", "thanks", "order", "package", "delivered", "where is my order"];
  const svHints = ["hej", "tack", "beställning", "paket", "levererad", "var är min beställning"];
  const deHints = ["hallo", "danke", "bestellung", "paket", "zugestellt", "wo ist meine bestellung"];
  const scores = [
    { locale: "da" as const, score: daHints.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0) },
    { locale: "en" as const, score: enHints.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0) },
    { locale: "sv" as const, score: svHints.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0) },
    { locale: "de" as const, score: deHints.reduce((sum, hint) => sum + (text.includes(hint) ? 1 : 0), 0) },
  ].sort((a, b) => b.score - a.score);
  if (!scores[0] || scores[0].score <= 0) return "en";
  return scores[0].locale;
}

function normalizeOrderLabel(orderNumber?: string | null): string {
  const raw = String(orderNumber || "").trim();
  if (!raw) return "your order";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function formatDateTime(value: string | null | undefined, locale: SupportedLocale): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const localeTag = locale === "da" ? "da-DK" : locale === "sv" ? "sv-SE" : locale === "de" ? "de-DE" : "en-GB";
  const date = parsed.toLocaleDateString(localeTag, {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
  });
  const time = parsed.toLocaleTimeString(localeTag, {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (locale === "da") return `${date} kl. ${time}`;
  if (locale === "sv") return `${date} kl. ${time}`;
  if (locale === "de") return `${date} um ${time}`;
  return `${date} at ${time}`;
}

function mapSnapshotStatus(snapshot: TrackingSnapshot | null): ReplyStatus {
  const code = String(snapshot?.statusCode || "").toLowerCase();
  if (code.includes("delivered")) return "DELIVERED";
  if (code.includes("out_for_delivery")) return "INDELIVERY";
  if (code.includes("pickup")) return "DELIVEREDPS";
  if (code.includes("exception")) return "NOTDELIVERED";
  if (code.includes("in_transit")) return "INTRANSIT";
  return "UNKNOWN";
}

function mapStatus(rawStatus: string | null | undefined, snapshot: TrackingSnapshot | null): ReplyStatus {
  const status = String(rawStatus || "").toUpperCase().trim();
  if (status === "DELIVEREDPS") return "DELIVEREDPS";
  if (status === "DELIVERED" || status === "FINAL" || status === "DELIVERED_AT_ADDRESS") return "DELIVERED";
  if (status === "INDELIVERY") return "INDELIVERY";
  if (status === "INTRANSIT") return "INTRANSIT";
  if (status === "NOTDELIVERED" || status === "CANCELED") return "NOTDELIVERED";
  if (status === "PREADVICE") return "PREADVICE";
  if (status === "OUT_FOR_DELIVERY") return "INDELIVERY";
  if (status === "IN_TRANSIT") return "INTRANSIT";
  if (status === "PICKUP_READY") return "DELIVEREDPS";
  if (status === "EXCEPTION") return "NOTDELIVERED";
  if (status === "UNKNOWN") return "UNKNOWN";
  return mapSnapshotStatus(snapshot);
}

export function isParcelShopDelivery(input: TrackingReplyInput): boolean {
  if (input.deliveredToParcelShop) return true;
  const status = String(input.status || "").toUpperCase();
  if (status === "DELIVEREDPS") return true;
  const code = String(input.latestEventCode || "").toUpperCase();
  const desc = String(input.latestEventDescription || "").toLowerCase();
  return code.includes("PS") || /parcel.?shop|pakkeshop|paketshop|paketshop/i.test(desc);
}

export function shouldFetchParcelShopInfo(input: TrackingReplyInput): boolean {
  if (!isParcelShopDelivery(input)) return false;
  if (input.parcelShopName || input.parcelShopAddressLine) return false;
  return true;
}

export function formatParcelShopDescription(
  input: TrackingReplyInput,
  locale: string,
): string | null {
  const normalizedLocale = normalizeLocale(locale);
  const name = String(input.parcelShopName || "").trim();
  const addressLine = String(input.parcelShopAddressLine || "").trim();
  const cityPart = [input.parcelShopPostalCode, input.parcelShopCity]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const address = [addressLine, cityPart].filter(Boolean).join(", ").trim();

  if (!name && !address) {
    if (normalizedLocale === "da") return "leveret i en GLS pakkeshop";
    if (normalizedLocale === "sv") return "levererat till ett GLS paketombud";
    if (normalizedLocale === "de") return "in einem GLS Paketshop zugestellt";
    return "delivered to a GLS parcel shop";
  }
  if (name && address) return `${name} (${address})`;
  return name || address;
}

function normalizeLocale(locale: string): SupportedLocale {
  const raw = String(locale || "").toLowerCase();
  if (raw.startsWith("da")) return "da";
  if (raw.startsWith("sv")) return "sv";
  if (raw.startsWith("de")) return "de";
  if (raw.startsWith("en")) return "en";
  return "en";
}

function buildReplyCopy(locale: SupportedLocale): ReplyCopy {
  if (locale === "da") {
    return {
      greeting: (name) => (String(name || "").trim() ? `Hej ${name},` : "Hej,"),
      fallbackNoTracking: [
        "Jeg har tjekket ordren, men der er ingen ny tracking-opdatering endnu.",
        "Jeg kan ikke se en ny tracking-scanning endnu.",
      ],
      statusLead: {
        DELIVERED: [
          "Vi kan se i tracking, at din ordre {order} er blevet leveret.",
          "Ifølge tracking blev din ordre {order} leveret.",
          "Tracking viser, at din ordre {order} blev leveret.",
        ],
        DELIVEREDPS: [
          "Vi kan se i tracking, at din ordre {order} er leveret i en GLS pakkeshop.",
          "Ifølge tracking blev din ordre {order} leveret i en GLS pakkeshop.",
          "Tracking viser, at din ordre {order} er afleveret i en GLS pakkeshop.",
        ],
        INDELIVERY: [
          "Din ordre {order} er ude til levering i dag.",
          "Godt nyt, din ordre {order} er ude til levering.",
          "Tracking viser, at din ordre {order} er på vej ud til levering i dag.",
        ],
        INTRANSIT: [
          "Din ordre {order} er på vej.",
          "Vi kan se i tracking, at din ordre {order} er i transit.",
          "Tracking viser, at din ordre {order} er under transport.",
        ],
        NOTDELIVERED: [
          "Der ser ud til at have været et mislykket leveringsforsøg på din ordre {order}.",
          "Tracking viser, at leveringen af din ordre {order} ikke lykkedes i første forsøg.",
          "Din ordre {order} er ikke leveret endnu på grund af et leveringsproblem.",
        ],
        PREADVICE: [
          "GLS har modtaget forsendelsesoplysningerne for din ordre {order}, men pakken er endnu ikke registreret som indleveret.",
          "Din ordre {order} er oprettet hos GLS, men den er ikke scannet ind endnu.",
          "Tracking viser for nu kun forsendelsesoplysninger for din ordre {order}.",
        ],
        UNKNOWN: [
          "Jeg har tjekket tracking på din ordre {order}.",
          "Jeg har slået din ordre {order} op i tracking.",
          "Vi har tjekket trackingstatus på din ordre {order}.",
        ],
      },
      statusDetail: {
        deliveredAt: "Leveret den {datetime}.",
        inDeliveryEta: "Forventet levering: {datetime}.",
        inDeliveryScan: "Seneste scanning: {datetime}.",
        inTransitLatest: "Seneste opdatering: {event}.",
        notDeliveredLatest: "Seneste opdatering: {event}.",
        preAdviceLatest: "Seneste opdatering: {event}.",
      },
      parcelShopLine: {
        generic: "Pakken er leveret i en GLS pakkeshop.",
        withName: "Pakken er leveret i pakkeshoppen: {shop}.",
        withAddress: "Pakken er leveret i pakkeshoppen: {shop}.",
      },
      trackingLine: "Trackingnummer: {trackingNumber}.",
      linkLine: "Du kan følge pakken her: {trackingUrl}",
      reassuranceByStatus: {
        DELIVERED: [
          "Hvis du mod forventning ikke har modtaget pakken, så skriv endelig tilbage, så starter vi en undersøgelse med det samme.",
          "Hvis du ikke kan finde pakken, så skriv gerne tilbage, så hjælper vi videre med det samme.",
          "Hvis pakken mod forventning mangler, så sig endelig til, så starter vi en undersøgelse med det samme.",
        ],
        DELIVEREDPS: [
          "Hvis du ikke kan finde pakken i pakkeshoppen, så skriv tilbage til os, så undersøger vi det med det samme.",
          "Hvis pakken ikke ligger klar i pakkeshoppen, så sig endelig til, så hjælper vi videre med det samme.",
          "Hvis du mod forventning ikke kan hente pakken, så skriv gerne tilbage, så starter vi en undersøgelse.",
        ],
        INDELIVERY: [
          "Hvis den ikke bliver leveret i dag, så skriv endelig tilbage, så undersøger vi det med det samme.",
          "Hvis den ikke kommer i dag, så sig til, så hjælper vi videre med det samme.",
          "Hvis leveringen trækker ud, så skriv gerne tilbage, så følger vi op med transportøren.",
        ],
        INTRANSIT: [
          "Hvis den ikke bevæger sig de næste hverdage, så skriv tilbage, så undersøger vi det.",
          "Hvis der ikke kommer nye scans snart, så sig til, så følger vi op med transportøren.",
          "Hvis du ikke ser fremdrift i tracking, så skriv gerne tilbage, så hjælper vi videre.",
        ],
        NOTDELIVERED: [
          "Skriv gerne tilbage, hvis du vil have os til at hjælpe med næste skridt med det samme.",
          "Hvis du ønsker, at vi tager fat i transportøren med det samme, så svar blot på denne mail.",
          "Giv gerne besked, så hjælper vi dig videre med det samme.",
        ],
        PREADVICE: [
          "Skriv gerne tilbage, hvis du ønsker en ny status senere i dag.",
          "Hvis du vil, følger vi op så snart der kommer første scanning.",
          "Sig endelig til, hvis du vil have os til at holde ekstra øje med forsendelsen.",
        ],
        UNKNOWN: [
          "Skriv gerne tilbage, hvis du vil have os til at undersøge den nærmere.",
          "Hvis du vil, følger vi op manuelt med transportøren.",
          "Svar endelig på denne mail, hvis du ønsker, at vi undersøger den med det samme.",
        ],
      },
      signoff: "God dag.",
    };
  }

  if (locale === "sv") {
    return {
      greeting: (name) => (String(name || "").trim() ? `Hej ${name},` : "Hej,"),
      fallbackNoTracking: ["Jag har kollat ordern, men ser ingen ny spårningsuppdatering ännu."],
      statusLead: {
        DELIVERED: ["Vi kan se i spårningen att din order {order} har levererats."],
        DELIVEREDPS: ["Vi kan se i spårningen att din order {order} har levererats till ett GLS paketombud."],
        INDELIVERY: ["Din order {order} är ute för leverans i dag."],
        INTRANSIT: ["Din order {order} är på väg."],
        NOTDELIVERED: ["Spårningen visar att leveransförsöket för order {order} inte lyckades."],
        PREADVICE: ["GLS har fått försändelseinformationen för order {order}, men paketet är ännu inte inskannat."],
        UNKNOWN: ["Jag har kontrollerat spårningen för order {order}."],
      },
      statusDetail: {
        deliveredAt: "Levererad: {datetime}.",
        inDeliveryEta: "Beräknad leverans: {datetime}.",
        inDeliveryScan: "Senaste skanning: {datetime}.",
        inTransitLatest: "Senaste uppdatering: {event}.",
        notDeliveredLatest: "Senaste uppdatering: {event}.",
        preAdviceLatest: "Senaste uppdatering: {event}.",
      },
      parcelShopLine: {
        generic: "Paketet är levererat till ett GLS paketombud.",
        withName: "Paketet är levererat till ombudet: {shop}.",
        withAddress: "Paketet är levererat till ombudet: {shop}.",
      },
      trackingLine: "Spårningsnummer: {trackingNumber}.",
      linkLine: "Du kan följa paketet här: {trackingUrl}",
      reassuranceByStatus: {
        DELIVERED: ["Om du mot förmodan inte har fått paketet, svara gärna så startar vi en utredning direkt."],
        DELIVEREDPS: ["Om paketet inte finns hos ombudet, svara gärna så hjälper vi dig direkt."],
        INDELIVERY: ["Om paketet inte levereras i dag, svara gärna så följer vi upp direkt."],
        INTRANSIT: ["Om spårningen inte uppdateras snart, svara gärna så hjälper vi dig vidare."],
        NOTDELIVERED: ["Svara gärna om du vill att vi hjälper dig med nästa steg direkt."],
        PREADVICE: ["Svara gärna om du vill att vi följer upp senare i dag."],
        UNKNOWN: ["Svara gärna om du vill att vi undersöker ärendet närmare."],
      },
      signoff: "Ha en fin dag.",
    };
  }

  if (locale === "de") {
    return {
      greeting: (name) => (String(name || "").trim() ? `Hallo ${name},` : "Hallo,"),
      fallbackNoTracking: ["Ich habe die Sendung geprüft, sehe aber noch kein neues Tracking-Update."],
      statusLead: {
        DELIVERED: ["Laut Tracking wurde Ihre Bestellung {order} zugestellt."],
        DELIVEREDPS: ["Laut Tracking wurde Ihre Bestellung {order} in einem GLS Paketshop zugestellt."],
        INDELIVERY: ["Ihre Bestellung {order} ist heute in Zustellung."],
        INTRANSIT: ["Ihre Bestellung {order} ist auf dem Weg."],
        NOTDELIVERED: ["Das Tracking zeigt einen fehlgeschlagenen Zustellversuch für Bestellung {order}."],
        PREADVICE: ["GLS hat die Sendungsdaten für Bestellung {order} erhalten, das Paket wurde aber noch nicht übergeben."],
        UNKNOWN: ["Ich habe das Tracking Ihrer Bestellung {order} geprüft."],
      },
      statusDetail: {
        deliveredAt: "Zugestellt am {datetime}.",
        inDeliveryEta: "Voraussichtliche Zustellung: {datetime}.",
        inDeliveryScan: "Letzter Scan: {datetime}.",
        inTransitLatest: "Letztes Update: {event}.",
        notDeliveredLatest: "Letztes Update: {event}.",
        preAdviceLatest: "Letztes Update: {event}.",
      },
      parcelShopLine: {
        generic: "Das Paket wurde in einem GLS Paketshop zugestellt.",
        withName: "Das Paket wurde im Paketshop zugestellt: {shop}.",
        withAddress: "Das Paket wurde im Paketshop zugestellt: {shop}.",
      },
      trackingLine: "Sendungsnummer: {trackingNumber}.",
      linkLine: "Hier können Sie das Paket verfolgen: {trackingUrl}",
      reassuranceByStatus: {
        DELIVERED: ["Falls Sie das Paket wider Erwarten nicht erhalten haben, antworten Sie bitte, dann starten wir sofort eine Untersuchung."],
        DELIVEREDPS: ["Falls das Paket im Paketshop nicht auffindbar ist, antworten Sie bitte, dann helfen wir sofort weiter."],
        INDELIVERY: ["Falls es heute nicht zugestellt wird, antworten Sie bitte, dann prüfen wir es direkt."],
        INTRANSIT: ["Wenn sich das Tracking nicht bald aktualisiert, antworten Sie bitte, dann helfen wir weiter."],
        NOTDELIVERED: ["Antworten Sie gerne, wenn wir Sie direkt beim weiteren Vorgehen unterstützen sollen."],
        PREADVICE: ["Antworten Sie gerne, wenn wir später heute erneut prüfen sollen."],
        UNKNOWN: ["Antworten Sie gerne, wenn wir den Fall genauer prüfen sollen."],
      },
      signoff: "Viele Grüße.",
    };
  }

  return {
    greeting: (name) => (String(name || "").trim() ? `Hi ${name},` : "Hi,"),
    fallbackNoTracking: ["I checked your order, but I can't see a new tracking update yet."],
    statusLead: {
      DELIVERED: [
        "We can see in tracking that your order {order} has been delivered.",
        "According to tracking, your order {order} was delivered.",
        "Tracking shows that your order {order} has been delivered.",
      ],
      DELIVEREDPS: [
        "We can see in tracking that your order {order} was delivered to a GLS parcel shop.",
        "According to tracking, your order {order} was delivered to a GLS parcel shop.",
        "Tracking shows that your order {order} was handed in at a GLS parcel shop.",
      ],
      INDELIVERY: [
        "Your order {order} is out for delivery today.",
        "Good news, your order {order} is currently out for delivery.",
        "Tracking shows your order {order} is on the vehicle for delivery today.",
      ],
      INTRANSIT: [
        "Your order {order} is on the way.",
        "We can see in tracking that your order {order} is in transit.",
        "Tracking shows your order {order} is moving through the network.",
      ],
      NOTDELIVERED: [
        "Tracking indicates that delivery of your order {order} was not successful.",
        "It looks like there was an unsuccessful delivery attempt for your order {order}.",
        "Your order {order} was not delivered due to a delivery issue.",
      ],
      PREADVICE: [
        "GLS has received shipment data for your order {order}, but the parcel has not been handed over yet.",
        "Your order {order} is pre-advised with GLS, but not scanned in as handed over yet.",
        "Tracking currently only shows shipment pre-advice for your order {order}.",
      ],
      UNKNOWN: [
        "I checked tracking for your order {order}.",
        "I've looked up your order {order} in tracking.",
        "We've reviewed tracking for your order {order}.",
      ],
    },
    statusDetail: {
      deliveredAt: "Delivered on {datetime}.",
      inDeliveryEta: "Expected delivery: {datetime}.",
      inDeliveryScan: "Latest scan: {datetime}.",
      inTransitLatest: "Latest update: {event}.",
      notDeliveredLatest: "Latest update: {event}.",
      preAdviceLatest: "Latest update: {event}.",
    },
    parcelShopLine: {
      generic: "The parcel was delivered to a GLS parcel shop.",
      withName: "The parcel was delivered to parcel shop: {shop}.",
      withAddress: "The parcel was delivered to parcel shop: {shop}.",
    },
    trackingLine: "Tracking number: {trackingNumber}.",
    linkLine: "You can follow the parcel here: {trackingUrl}",
    reassuranceByStatus: {
      DELIVERED: [
        "If you haven't received it despite this status, reply and we'll start an investigation right away.",
        "If you can't find the parcel, please reply and we'll help immediately.",
        "If the parcel is unexpectedly missing, let us know and we'll open an investigation right away.",
      ],
      DELIVEREDPS: [
        "If the parcel is not available at the parcel shop, reply and we'll investigate immediately.",
        "If you can't locate it at the parcel shop, let us know and we'll help right away.",
        "If it isn't available for pickup as expected, reply and we'll investigate immediately.",
      ],
      INDELIVERY: [
        "If it is not delivered today, reply and we'll follow up right away.",
        "If delivery doesn't happen today, let us know and we'll investigate immediately.",
        "If today's delivery misses, reply and we'll take it from there straight away.",
      ],
      INTRANSIT: [
        "If there is no movement in the next business days, reply and we'll investigate.",
        "If tracking does not update soon, let us know and we'll follow up with the carrier.",
        "If you'd like us to monitor it more closely, just reply and we'll help.",
      ],
      NOTDELIVERED: [
        "Reply if you'd like us to help with the next step right away.",
        "If you want us to follow up with the carrier immediately, just reply to this email.",
        "Let us know and we'll help you move this forward right away.",
      ],
      PREADVICE: [
        "Reply if you want us to check again later today.",
        "If you'd like, we can follow up as soon as the first physical scan appears.",
        "Let us know if you want us to keep a close eye on this shipment.",
      ],
      UNKNOWN: [
        "Reply if you'd like us to investigate this in more detail.",
        "If you want, we can follow up manually with the carrier.",
        "Feel free to reply if you want us to investigate right away.",
      ],
    },
    signoff: "Have a great day.",
  };
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replaceAll(`{${key}}`, value);
  }
  return output;
}

async function buildTrackingReplyWithOpenAI(options: {
  customerMessage: string;
  input: TrackingReplyInput;
  seed: number;
}): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You write short ecommerce tracking replies. Reply in the same language as the customer message. " +
            "Never invent facts. Use only provided tracking facts. Keep tone professional, natural, concise. " +
            "Do not output JSON or markdown.",
        },
        {
          role: "user",
          content:
            `Customer message:\n${options.customerMessage}\n\n` +
            `Tracking facts (source of truth):\n${JSON.stringify(options.input, null, 2)}\n\n` +
            `Variation seed: ${options.seed}\n\n` +
            "Write a short customer-support reply with:\n" +
            "- Greeting\n" +
            "- status summary\n" +
            "- tracking number and link if available\n" +
            "- parcel shop mention only when deliveredToParcelShop is true\n" +
            "- a short next-step line when relevant.\n" +
            "If language is unclear, default to English.",
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) return null;
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  return text || null;
}

function normalizeReplyLinks(text: string): string {
  const input = String(text || "");
  if (!input) return "";
  return input
    // Replace markdown links with plain URL so we avoid "[Tracking link](...)" output.
    .replace(/\[[^\]]+\]\s*\((https?:\/\/[^\s)]+)\)/gi, "$1")
    // Normalize "(https://...)" to plain URL to keep link parsing reliable.
    .replace(/\((https?:\/\/[^\s)]+)\)/gi, "$1")
    // Remove leftover placeholder labels when models output "[tracking link]" without URL.
    .replace(/\[(tracking\s*link|sporingslink|spårningslänk|sendungsverfolgung)\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildTrackingReplyInput(options: {
  locale: SupportedLocale;
  customerFirstName?: string | null;
  order: any;
  tracking: TrackingDetail;
}): TrackingReplyInput {
  const orderRaw =
    String(options.order?.name || "").trim() ||
    String(options.order?.order_number || "").trim() ||
    null;
  const snapshot = options.tracking.snapshot || null;
  const pickup = snapshot?.pickupPoint || null;
  const latest = snapshot?.lastEvent || null;
  const statusDateTime =
    snapshot?.deliveredAt ||
    snapshot?.outForDeliveryAt ||
    snapshot?.pickupReadyAt ||
    options.tracking.lastEventAt ||
    latest?.occurredAt ||
    null;

  return {
    locale: options.locale,
    customerFirstName: options.customerFirstName || null,
    orderNumber: orderRaw,
    trackingNumber: options.tracking.trackingNumber || null,
    trackingUrl: options.tracking.trackingUrl || null,
    status: options.tracking.carrierStatus || snapshot?.statusCode || null,
    statusDateTime,
    latestEventDescription: latest?.description || options.tracking.statusText || null,
    latestEventCode: latest?.code || null,
    deliveredToParcelShop: options.tracking.deliveredToParcelShop || false,
    parcelShopName: pickup?.name || null,
    parcelShopAddressLine: pickup?.address || null,
    parcelShopPostalCode: pickup?.postalCode || null,
    parcelShopCity: pickup?.city || null,
  };
}

function composeTrackingReply(input: TrackingReplyInput, seed: number): string {
  const locale = normalizeLocale(input.locale);
  const copy = buildReplyCopy(locale);
  const status = mapStatus(input.status, null);
  const orderLabel = normalizeOrderLabel(input.orderNumber);
  const customerName = String(input.customerFirstName || "").trim();
  const statusDate = formatDateTime(input.statusDateTime, locale);
  const eventText = String(input.latestEventDescription || "").trim();
  const parcelShopText = formatParcelShopDescription(input, locale);
  const parcelShopDelivery = isParcelShopDelivery(input);

  const leadVariants = copy.statusLead[status] || copy.statusLead.UNKNOWN;
  const lead = applyTemplate(
    pickVariant(seed + 1, leadVariants),
    { order: orderLabel },
  );

  let detailLine = "";
  if ((status === "DELIVERED" || status === "DELIVEREDPS") && statusDate) {
    detailLine = applyTemplate(copy.statusDetail.deliveredAt, { datetime: statusDate });
  } else if (status === "INDELIVERY") {
    if (statusDate) {
      detailLine = applyTemplate(copy.statusDetail.inDeliveryEta, { datetime: statusDate });
    } else if (eventText) {
      detailLine = applyTemplate(copy.statusDetail.inTransitLatest, { event: eventText });
    }
  } else if (status === "INTRANSIT" && eventText) {
    detailLine = applyTemplate(copy.statusDetail.inTransitLatest, { event: eventText });
  } else if (status === "NOTDELIVERED" && eventText) {
    detailLine = applyTemplate(copy.statusDetail.notDeliveredLatest, { event: eventText });
  } else if (status === "PREADVICE" && eventText) {
    detailLine = applyTemplate(copy.statusDetail.preAdviceLatest, { event: eventText });
  }

  let parcelShopLine = "";
  if (parcelShopDelivery) {
    if (parcelShopText) {
      const template =
        input.parcelShopName || input.parcelShopAddressLine
          ? copy.parcelShopLine.withAddress
          : copy.parcelShopLine.generic;
      parcelShopLine = applyTemplate(template, { shop: parcelShopText });
    } else {
      parcelShopLine = copy.parcelShopLine.generic;
    }
  }

  const trackingLine = input.trackingNumber
    ? applyTemplate(copy.trackingLine, { trackingNumber: input.trackingNumber })
    : "";
  const linkLine = input.trackingUrl
    ? applyTemplate(copy.linkLine, { trackingUrl: input.trackingUrl })
    : "";

  const reassurance = pickVariant(seed + 2, copy.reassuranceByStatus[status] || copy.reassuranceByStatus.UNKNOWN);

  return [
    copy.greeting(customerName),
    "",
    lead,
    detailLine,
    parcelShopLine,
    trackingLine,
    linkLine,
    "",
    reassurance,
    "",
    copy.signoff,
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();
}

export const buildTrackingReplyFallback = (options: {
  customerFirstName: string;
  order: any;
  tracking: TrackingDetail | null;
  threadKey?: string;
  locale?: SupportedLocale;
}) => {
  const locale = normalizeLocale(options.locale || "en");
  const copy = buildReplyCopy(locale);
  const orderLabel = normalizeOrderLabel(
    String(options.order?.name || "").trim() || String(options.order?.order_number || "").trim() || null,
  );
  const customerName = String(options.customerFirstName || "").trim();
  const seed = hashString(`${options.threadKey || ""}|${orderLabel}|${customerName}`);

  if (!options.tracking) {
    return [
      copy.greeting(customerName),
      "",
      pickVariant(seed + 1, copy.fallbackNoTracking),
      "",
      pickVariant(seed + 2, copy.reassuranceByStatus.UNKNOWN),
      "",
      copy.signoff,
    ].join("\n");
  }

  const input = buildTrackingReplyInput({
    locale,
    customerFirstName: customerName,
    order: options.order,
    tracking: options.tracking,
  });
  return composeTrackingReply(input, seed);
};

export async function buildTrackingReplySameLanguage(options: {
  customerMessage: string;
  customerFirstName?: string;
  order: any;
  tracking: TrackingDetail | null;
  threadKey?: string;
}): Promise<string | null> {
  const locale = detectReplyLocale(options.customerMessage || "");
  const customerName = String(options.customerFirstName || "").trim();
  const orderLabel = normalizeOrderLabel(
    String(options.order?.name || "").trim() || String(options.order?.order_number || "").trim() || null,
  );
  const seed = hashString(`${options.threadKey || ""}|${options.customerMessage || ""}|${orderLabel}`);

  if (!options.tracking) {
    return buildTrackingReplyFallback({
      customerFirstName: customerName,
      order: options.order,
      tracking: null,
      threadKey: options.threadKey,
      locale,
    });
  }

  const input = buildTrackingReplyInput({
    locale,
    customerFirstName: customerName,
    order: options.order,
    tracking: options.tracking,
  });
  // Prefer deterministic tracking copy so replies stay precise and stable.
  // Optional AI phrasing can be enabled with TRACKING_REPLY_USE_OPENAI=true.
  if (TRACKING_REPLY_USE_OPENAI) {
    const aiReply = await buildTrackingReplyWithOpenAI({
      customerMessage: options.customerMessage || "",
      input,
      seed,
    });
    if (aiReply) return normalizeReplyLinks(aiReply);
  }
  return normalizeReplyLinks(composeTrackingReply(input, seed));
}
