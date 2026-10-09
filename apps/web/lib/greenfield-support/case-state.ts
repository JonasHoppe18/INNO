import { z } from "zod";
import { TurnIRSchema, type TurnIR } from "./turn-ir";
import { compilePreciseAnswerRequests } from "./answer-facets";
import type { ResponseValidationResult } from "./response-contract";
import type { CaseState, ConversationContext, TenantContext, RemedyAuthorization } from "./types";

const reference = (value: string | null | undefined) => String(value ?? "").trim().replace(/^#/, "").toLowerCase();
const email = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase() || null;
const action = TurnIRSchema.shape.actions.element.shape.action;
const CaseStateSchema = z.object({
  scope: z.object({ workspaceId: z.string().min(1), shopId: z.string().nullable(), caseId: z.string().min(1), customerEmail: z.string().email().nullable() }),
  customerEmail: z.string().email().optional(),
  identityUnavailable: z.boolean().optional(),
  pendingReadOnlyAnswers: z.array(z.object({
    id: z.string().min(1).max(200),
    request: TurnIRSchema.shape.answerRequests.unwrap().element.extend({ kind: z.enum(["product_care", "product_property"]), sourceText: z.string().min(1).max(1000) }),
    subjectRequirement: z.enum(["missing", "verification"]), verifiedProductId: z.string().min(1).optional(),
  })).max(8).optional(),
  pendingAction: z.object({ action, sourceText: z.string().min(1).max(1000), orderReference: z.string().nullable() }).optional(),
  requestedChange: z.object({ sourceText: z.string().min(1).max(1000), description: z.string().max(500).optional(), orderReference: z.string().nullable() }).optional(),
  orderConfirmation: z.object({ orderReference: z.string().min(1), sourceText: z.string().min(1).max(1000) }).optional(),
  actionConfirmation: z.object({ orderReference: z.string().min(1), action, sourceText: z.string().min(1).max(1000) }).optional(),
  address: z.object({ value: z.string().min(1).max(500), complete: z.boolean(), orderReference: z.string().min(1), details: TurnIRSchema.shape.address.unwrap().unwrap().shape.details.unwrap().unwrap().optional() }).optional(),
  lineChange: z.object({ sourceItem: z.string().nullable(), targetVariant: z.string().nullable(), quantity: z.number().int().min(1).nullable(), orderReference: z.string().nullable() }).optional(),
});

export function normalizeCaseState(value: unknown): CaseState | undefined {
  const parsed = CaseStateSchema.safeParse(value);
  return parsed.success ? parsed.data as CaseState : undefined;
}

function scopeMatches(state: CaseState, tenant: TenantContext): boolean {
  return state.scope.workspaceId === tenant.workspaceId && state.scope.shopId === (tenant.shopId ?? null)
    && (!tenant.caseId || state.scope.caseId === tenant.caseId)
    && (!state.scope.customerEmail || !email(tenant.customerEmail) || state.scope.customerEmail === email(tenant.customerEmail));
}

/** A customer quote is never a substitute for the server's verified identity. */
export function resolvedCaseEmail(previous: ConversationContext | undefined, tenant: TenantContext): string | null {
  if (email(tenant.customerEmail)) return email(tenant.customerEmail);
  const state = normalizeCaseState(previous?.caseState);
  return state && !state.identityUnavailable && tenant.caseId && scopeMatches(state, tenant) ? state.scope.customerEmail : null;
}

export function prepareCaseContext(previous: ConversationContext | undefined, tenant: TenantContext): ConversationContext {
  const state = normalizeCaseState(previous?.caseState);
  const keep = !previous?.caseState || Boolean(state && scopeMatches(state, tenant));
  const known = keep ? previous : undefined;
  return {
    turn: known?.turn ?? 0,
    activeOrder: known?.activeOrder ? { ...known.activeOrder, state: "unresolved", order: null } : null,
    customerSignal: known?.customerSignal ?? null,
    ...(known?.customerProvided ? { customerProvided: known.customerProvided } : {}),
    ...(known?.orderCandidates ? { orderCandidates: known.orderCandidates } : {}),
    caseState: {
      ...(keep && state ? { ...state, pendingReadOnlyAnswers: tenant.caseId
        ? state.pendingReadOnlyAnswers?.map(value => ({ ...value, request: { ...value.request,
          facets: value.request.facets ? [...value.request.facets] : value.request.facets,
          qualifiers: value.request.qualifiers?.map(qualifier => ({ ...qualifier })),
        } })) ?? [] : [] } : {}),
      scope: { workspaceId: tenant.workspaceId, shopId: tenant.shopId ?? null,
        caseId: tenant.caseId ?? (keep && state ? state.scope.caseId : crypto.randomUUID()),
        customerEmail: resolvedCaseEmail(known, tenant) ?? (keep && state ? state.scope.customerEmail : null) },
      ...(email(tenant.customerEmail) ? { identityUnavailable: false } : {}),
    },
  };
}

/** Associate normalized customer meaning with this case/order, never with a provider fact. */
export function advanceCaseContext(context: ConversationContext, ir: TurnIR | null, message: string,
  order: ConversationContext["activeOrder"] = context.activeOrder): ConversationContext {
  const state = normalizeCaseState(context.caseState)!;
  const next: CaseState = { ...state };
  const orderReference = order?.requestedOrderId ?? null;
  const changedOrder = Boolean(orderReference && context.activeOrder?.requestedOrderId
    && reference(orderReference) !== reference(context.activeOrder.requestedOrderId));
  const oldBinding = next.pendingAction?.orderReference ?? next.requestedChange?.orderReference
    ?? next.orderConfirmation?.orderReference ?? next.address?.orderReference;
  if (changedOrder || (oldBinding && orderReference && reference(oldBinding) !== reference(orderReference))) {
    delete next.pendingAction; delete next.requestedChange; delete next.orderConfirmation;
    delete next.actionConfirmation; delete next.address; delete next.lineChange;
  }
  const suppliedEmail = message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  if (suppliedEmail) next.customerEmail = email(suppliedEmail)!;
  const intent = ir?.actions[0];
  if (intent) {
    if (next.pendingAction?.action !== intent.action) delete next.actionConfirmation;
    next.pendingAction = { action: intent.action, sourceText: intent.sourceText,
      orderReference: intent.orderReference ?? orderReference };
    delete next.requestedChange;
  } else if (ir?.orderContext === "change" || ir?.changeDescription) {
    next.requestedChange = { sourceText: message.slice(0, 1000), orderReference,
      ...(ir.changeKind && ir.changeDescription ? { description: ir.changeDescription } : {}) };
  }
  if (next.pendingAction && !next.pendingAction.orderReference && orderReference) next.pendingAction = { ...next.pendingAction, orderReference };
  if (next.requestedChange && !next.requestedChange.orderReference && orderReference) next.requestedChange = { ...next.requestedChange, orderReference };
  if (ir?.address && orderReference) {
    if (next.address && next.address.value !== ir.address.value) delete next.actionConfirmation;
    next.address = { value: ir.address.value, complete: ir.address.complete, orderReference, ...(ir.address.details ? { details: ir.address.details } : {}) };
  }
  if (ir?.lineChange) {
    const change = { sourceItem: ir.lineChange.sourceItem ?? next.lineChange?.sourceItem ?? null,
      targetVariant: ir.lineChange.targetVariant ?? next.lineChange?.targetVariant ?? null,
      quantity: ir.lineChange.quantity ?? next.lineChange?.quantity ?? null, orderReference };
    if (next.lineChange && JSON.stringify(next.lineChange) !== JSON.stringify(change)) delete next.actionConfirmation;
    next.lineChange = change;
  }
  if (ir?.confirmation && order?.state === "verified" && order.order) {
    if (ir.confirmation.confirmed) {
      next.orderConfirmation = { orderReference: order.requestedOrderId, sourceText: ir.confirmation.sourceText };
      if (next.pendingAction) next.actionConfirmation = { ...next.orderConfirmation, action: next.pendingAction.action };
    } else {
      delete next.orderConfirmation; delete next.actionConfirmation; delete next.pendingAction;
    }
  }
  return { ...context, activeOrder: order, caseState: next,
    ...(changedOrder ? { customerProvided: undefined } : {}) };
}

/** Carry a resolved request into its intake follow-ups only after a successful interpretation. */
export function caseActionIntents(context: ConversationContext, ir: TurnIR | null, hasOrderReference = false): TurnIR | null {
  if (!ir) return null;
  const state = context.caseState;
  const pending = state?.pendingAction;
  const address = state?.address;
  const binding = context.activeOrder?.requestedOrderId;
  if (ir.actions.length) return { ...ir, actions: ir.actions.map((intent) => ({ ...intent,
    addressProvided: intent.addressProvided || Boolean(intent.action === "update_address" && address?.complete
      && reference(address.orderReference) === reference(binding)
      && (!intent.orderReference || reference(intent.orderReference) === reference(binding))) })) };
  if (!pending || ir.orderContext === "status" || (!hasOrderReference && !ir.confirmation && !ir.address && !ir.lineChange)) return ir;
  if (pending.orderReference && binding && reference(pending.orderReference) !== reference(binding)) return ir;
  return { ...ir, ...(state?.lineChange ? { lineChange: state.lineChange } : {}), actions: [{ action: pending.action as TurnIR["actions"][number]["action"],
    sourceText: pending.sourceText, orderReference: pending.orderReference,
    addressProvided: Boolean(address?.complete && reference(address.orderReference) === reference(binding)) }] };
}

export function confirmedCaseAction(context: ConversationContext, capability: string): boolean {
  const confirmation = context.caseState?.actionConfirmation;
  return Boolean(confirmation && confirmation.action === capability && context.activeOrder?.state === "verified"
    && context.activeOrder.order && reference(confirmation.orderReference) === reference(context.activeOrder.requestedOrderId));
}

export interface IntakeRequirement {
  field: "customer_email" | "identity_verification" | "order_choice" | "order_reference" | "desired_change" | "variant_edit" | "order_lookup" | "photo";
  owner: "customer" | "human" | "live_data";
}

/** Requirements describe the missing owner, not a model's request for more input. */
export function caseIntakeRequirements(context: ConversationContext, ir: TurnIR | null,
  candidates: Array<{ orderNumber: string }> = [], orderReadStatus?: string, assessment?: RemedyAuthorization): IntakeRequirement[] {
  const state = context.caseState;
  if (state?.requestedChange?.description) return [{ field: "variant_edit", owner: "human" }];
  const relevant = Boolean(ir?.orderContext || ir?.actions.length || context.activeOrder
    || state?.pendingAction || state?.requestedChange);
  if (!relevant) return [];
  if (!state?.scope.customerEmail || state.identityUnavailable) return [{ field: state?.customerEmail ? "identity_verification" : "customer_email",
    owner: state?.customerEmail ? "human" : "customer" }];
  if (candidates.length > 1 && !context.activeOrder) return [{ field: "order_choice", owner: "customer" }];
  if (!context.activeOrder) return [orderReadStatus === "error" || orderReadStatus === "unavailable"
    ? { field: "order_lookup", owner: "live_data" } : { field: "order_reference", owner: "customer" }];
  if (context.activeOrder.state === "unresolved") return [{
    field: orderReadStatus === "not_found" ? "order_reference" : "order_lookup",
    owner: orderReadStatus === "not_found" ? "customer" : "live_data" }];
  if (context.activeOrder.state === "verified" && state.requestedChange && !state.pendingAction) {
    return [{ field: "desired_change", owner: "customer" }];
  }
  const activeAction = ir?.actions[0]?.action ?? state?.pendingAction?.action;
  const assessmentScoped = assessment && context.activeOrder.state === "verified" && context.activeOrder.order
    && assessment.workspaceId === state.scope.workspaceId && assessment.shopId === state.scope.shopId
    && reference(assessment.orderId) === reference(context.activeOrder.requestedOrderId)
    && assessment.action === activeAction && assessment.itemIds.length > 0
    && assessment.itemIds.every(id => context.activeOrder!.order!.items.some(item => reference(item.id) === reference(id)));
  if (assessmentScoped && assessment.requirements.some(r => r.name === "photo" && r.owner === "customer" && !r.satisfied)) {
    return [{ field: "photo", owner: "customer" }];
  }
  return [];
}


/** Lexical equivalence only; verified product IDs remain the identity boundary. */
export function normalizeReadOnlySubject(value: string): string {
  const words = value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words[0] === "the") words.shift();
  return words.join(" ");
}

export function deduplicateReadOnlySubjects(subjects: string[]): string[] {
  const unique = new Map<string, string>();
  for (const subject of subjects) {
    const key = normalizeReadOnlySubject(subject);
    if (!key || unique.has(key)) continue;
    const words = subject.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words[0]?.toLowerCase() === "the") words.shift();
    unique.set(key, words.join(" "));
  }
  return [...unique.values()];
}

export interface ReadOnlyAnswerBinding { id: string; requestIndex: number }

/** Carries customer intent only; no source values or operational facts persist here. */
export function prepareReadOnlyAnswers(context: ConversationContext, ir: TurnIR | null, message: string,
  groundedSubjects: string[]): { ir: TurnIR | null; bindings: ReadOnlyAnswerBinding[]; carried: string[]; closed: string[] } {
  const state = context.caseState!;
  let pending = state.pendingReadOnlyAnswers ?? [];
  if (ir?.readOnlyFollowup?.kind === "resolve") {
    const target = ir.readOnlyFollowup.targetRequestId;
    const selected = target ? pending.filter(value => value.id === target) : pending.length === 1 ? pending : [];
    const closed = selected.length === 1 ? [selected[0].id] : [];
    state.pendingReadOnlyAnswers = pending.filter(value => !closed.includes(value.id));
    return { ir, bindings: [], carried: [], closed };
  }
  if (!ir) return { ir, bindings: [], carried: [], closed: [] };
  const followup = ir.readOnlyFollowup;
  const subjects = deduplicateReadOnlySubjects(groundedSubjects);
  const subject = followup?.kind === "provide_subject" && followup.subject && subjects.length === 1
    && normalizeReadOnlySubject(subjects[0]) === normalizeReadOnlySubject(followup.subject) ? subjects[0] : null;
  const carried = subject && !ir.actions.length && !ir.orderContext && !ir.policyIntents?.length
    ? pending.filter(value => !value.request.subject || normalizeReadOnlySubject(value.request.subject) === normalizeReadOnlySubject(subject)) : [];
  // Subject identification is not a model-selected material question.
  const requests = carried.length ? carried.map(value => ({ ...value.request, subject })) : ir.answerRequests ?? [];
  const bindings: ReadOnlyAnswerBinding[] = carried.map((value, requestIndex) => ({ id: value.id, requestIndex }));
  if (!carried.length) for (const [requestIndex, request] of requests.entries()) {
    if (!["product_care", "product_property"].includes(request.kind) || !message.includes(request.sourceText)
      || !request.facets?.some(facet => ["cleaning_method", "prohibited_method", "cleaning_alternative"].includes(facet))) continue;
    const careFacets = request.facets.filter(facet => ["cleaning_method", "prohibited_method", "cleaning_alternative"].includes(facet));
    const storedRequest = { ...request, facets: careFacets,
      ...(request.propertyKey === "composition" || request.propertyKey === "dimensions" ? { propertyKey: "general" as const } : {}),
      qualifiers: request.qualifiers?.filter(qualifier => careFacets.includes(qualifier.facet)), sourceText: request.sourceText.slice(0, 1000),
      subject: request.subject && subjects.some(subject => normalizeReadOnlySubject(subject) === normalizeReadOnlySubject(request.subject!)) ? request.subject : null };
    const existing = pending.find(value => JSON.stringify(value.request) === JSON.stringify(storedRequest));
    const entry = existing ?? { id: `${state.scope.caseId}:read-only:${context.turn}:${requestIndex}`,
      request: storedRequest,
      subjectRequirement: storedRequest.subject ? "verification" as const : "missing" as const };
    if (!existing && pending.length < 8) pending = [...pending, entry];
    if (pending.includes(entry)) bindings.push({ id: entry.id, requestIndex });
  }
  state.pendingReadOnlyAnswers = pending;
  return { ir: { ...ir, answerRequests: requests }, bindings, carried: carried.map(value => value.id), closed: [] };
}

export function bindReadOnlyAnswer(context: ConversationContext, binding: ReadOnlyAnswerBinding,
  product: { id: string; title: string } | null): boolean {
  const entry = context.caseState?.pendingReadOnlyAnswers?.find(value => value.id === binding.id);
  if (!entry || !product || entry.verifiedProductId && entry.verifiedProductId !== product.id) return false;
  entry.request = { ...entry.request, subject: product.title };
  entry.subjectRequirement = "verification"; entry.verifiedProductId = product.id;
  return true;
}

/** An acknowledgement or merely approved-but-unrendered segment cannot close work. */
export function completeReadOnlyAnswers(context: ConversationContext, bindings: ReadOnlyAnswerBinding[],
  validation: ResponseValidationResult): string[] {
  const closed: string[] = [];
  for (const binding of bindings) {
    const entry = context.caseState?.pendingReadOnlyAnswers?.find(value => value.id === binding.id);
    if (!entry?.verifiedProductId) continue;
    const requested = compilePreciseAnswerRequests([entry.request]);
    if (requested.length && requested.every(request => validation.coverage?.obligations.some(obligation =>
      obligation.id === `answer.${binding.requestIndex}.${request.facet}` && obligation.status === "supported"
      && obligation.subjectIds?.includes(entry.verifiedProductId!) && obligation.satisfied && obligation.rendered === true))) closed.push(entry.id);
  }
  if (context.caseState) context.caseState.pendingReadOnlyAnswers = (context.caseState.pendingReadOnlyAnswers ?? []).filter(value => !closed.includes(value.id));
  return closed;
}
