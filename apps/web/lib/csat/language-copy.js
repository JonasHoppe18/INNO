export const CUSTOMER_SATISFACTION_LANGUAGE_COPY = {
  en: {
    subject: "How did we do?",
    headline: "How was your support experience?",
    intro: "We'd love to hear how we did. Your feedback helps us make every reply better.",
    thankYou: "Thanks for helping us improve.",
    footer: "You're receiving this because your support conversation was resolved.",
    lowLabel: "Very poor",
    highLabel: "Excellent",
    instruction: "Click a number to share your feedback. No sign-in required.",
    submit: "Submit feedback",
    sending: "Sending…",
    thankYouTitle: "Thank you",
  },
  da: {
    subject: "Hvordan klarede vi os?",
    headline: "Hvordan var din supportoplevelse?",
    intro: "Vi vil meget gerne høre, hvordan det gik. Din feedback hjælper os med at gøre hvert svar bedre.",
    thankYou: "Tak, fordi du hjælper os med at blive bedre.",
    footer: "Du modtager denne mail, fordi din supportsag er blevet løst.",
    lowLabel: "Meget dårlig",
    highLabel: "Fremragende",
    instruction: "Klik på et tal for at dele din feedback. Du behøver ikke logge ind.",
    submit: "Send feedback",
    sending: "Sender…",
    thankYouTitle: "Tak for din feedback",
  },
  de: {
    subject: "Wie haben wir abgeschnitten?",
    headline: "Wie war deine Support-Erfahrung?",
    intro: "Wir würden gerne erfahren, wie wir abgeschnitten haben. Dein Feedback hilft uns, jede Antwort zu verbessern.",
    thankYou: "Danke, dass du uns hilfst, besser zu werden.",
    footer: "Du erhältst diese E-Mail, weil dein Support-Anliegen gelöst wurde.",
    lowLabel: "Sehr schlecht",
    highLabel: "Ausgezeichnet",
    instruction: "Klicke auf eine Zahl, um dein Feedback zu teilen. Keine Anmeldung erforderlich.",
    submit: "Feedback senden",
    sending: "Wird gesendet…",
    thankYouTitle: "Vielen Dank",
  },
  es: {
    subject: "¿Qué tal lo hicimos?",
    headline: "¿Cómo fue tu experiencia con nuestro soporte?",
    intro: "Nos encantaría saber cómo lo hicimos. Tus comentarios nos ayudan a mejorar cada respuesta.",
    thankYou: "Gracias por ayudarnos a mejorar.",
    footer: "Recibes este correo porque tu conversación con soporte se ha resuelto.",
    lowLabel: "Muy mala",
    highLabel: "Excelente",
    instruction: "Haz clic en un número para compartir tus comentarios. No necesitas iniciar sesión.",
    submit: "Enviar comentarios",
    sending: "Enviando…",
    thankYouTitle: "Gracias",
  },
  fr: {
    subject: "Comment avons-nous fait ?",
    headline: "Comment s'est passée votre expérience avec notre support ?",
    intro: "Nous aimerions savoir comment nous nous en sommes sortis. Vos commentaires nous aident à améliorer chaque réponse.",
    thankYou: "Merci de nous aider à nous améliorer.",
    footer: "Vous recevez cet e-mail car votre conversation avec le support a été résolue.",
    lowLabel: "Très mauvaise",
    highLabel: "Excellente",
    instruction: "Cliquez sur un chiffre pour partager votre avis. Aucune connexion n'est nécessaire.",
    submit: "Envoyer l'avis",
    sending: "Envoi…",
    thankYouTitle: "Merci",
  },
  sv: {
    subject: "Hur gjorde vi?",
    headline: "Hur var din supportupplevelse?",
    intro: "Vi vill gärna veta hur det gick. Din feedback hjälper oss att göra varje svar bättre.",
    thankYou: "Tack för att du hjälper oss att bli bättre.",
    footer: "Du får det här mejlet eftersom din supportkonversation har lösts.",
    lowLabel: "Mycket dålig",
    highLabel: "Utmärkt",
    instruction: "Klicka på en siffra för att dela din feedback. Du behöver inte logga in.",
    submit: "Skicka feedback",
    sending: "Skickar…",
    thankYouTitle: "Tack",
  },
  no: {
    subject: "Hvordan gjorde vi det?",
    headline: "Hvordan var supportopplevelsen din?",
    intro: "Vi vil gjerne høre hvordan det gikk. Tilbakemeldingen din hjelper oss med å gjøre hvert svar bedre.",
    thankYou: "Takk for at du hjelper oss med å bli bedre.",
    footer: "Du mottar denne e-posten fordi supportsamtalen din er løst.",
    lowLabel: "Svært dårlig",
    highLabel: "Utmerket",
    instruction: "Klikk på et tall for å dele tilbakemeldingen din. Du trenger ikke å logge inn.",
    submit: "Send tilbakemelding",
    sending: "Sender…",
    thankYouTitle: "Takk",
  },
};

export function getCustomerSatisfactionLanguageCopy(language = "en") {
  return CUSTOMER_SATISFACTION_LANGUAGE_COPY[language] || CUSTOMER_SATISFACTION_LANGUAGE_COPY.en;
}

export function localizeCustomerSatisfactionValue(value, key, language = "en") {
  const copy = getCustomerSatisfactionLanguageCopy(language);
  const fallback = CUSTOMER_SATISFACTION_LANGUAGE_COPY.en[key];
  const text = String(value || "").trim();
  return !text || text === fallback ? copy[key] || fallback : text;
}
