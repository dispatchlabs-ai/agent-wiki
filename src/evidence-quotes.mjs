import { WikiError } from "./errors.mjs";
import { GitWiki, validId } from "./git-wiki.mjs";
import { EvidenceClient } from "./evidence-client.mjs";

export function validateEvidence(value) {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (e) =>
        !e ||
        typeof e !== "object" ||
        Object.keys(e).some(
          (k) => !["conversation", "event", "quote"].includes(k),
        ) ||
        typeof e.conversation !== "string" ||
        !/^chat-[a-f0-9]{24}$/.test(e.conversation) ||
        typeof e.event !== "string" ||
        !e.event ||
        e.event.length > 300 ||
        /[\u0000-\u0020]/.test(e.event) ||
        typeof e.quote !== "string" ||
        !e.quote.trim() ||
        e.quote.length > 2500,
    )
  )
    throw new WikiError(
      "INVALID_EVIDENCE",
      "Evidence requires a conversation, event and exact quote",
    );
}

// Called inside the writer lock. Receipts are checked before contacting the archive:
// a retry must still recover its durable result when the source service is offline.
export async function verifyDraftEvidence(repo, draft, base) {
  const verified = new Map();
  if (
    !draft ||
    !validId(draft.operation_id) ||
    !Array.isArray(draft.updates) ||
    draft.updates.length > 10
  )
    return verified;
  if (new GitWiki(repo).receipt(draft.operation_id)) return verified;
  const client = base ? new EvidenceClient(base) : null;
  const events = new Map();
  for (const update of draft.updates) {
    if (update?.evidence === undefined) continue;
    validateEvidence(update.evidence);
    const records = [];
    for (const source of update.evidence) {
      if (!client)
        throw new WikiError(
          "EVIDENCE_UNAVAILABLE",
          "Verified quotations require a configured external evidence service",
          503,
        );
      const key = JSON.stringify([source.conversation, source.event]);
      if (!events.has(key)) {
        try {
          events.set(
            key,
            await client.read(source.conversation, { event: source.event }),
          );
        } catch (error) {
          if (error instanceof WikiError && error.status === 404)
            throw new WikiError(
              "EVIDENCE_MISMATCH",
              "The quoted source conversation is unavailable",
            );
          throw error;
        }
      }
      const data = events.get(key);
      const message = data.messages?.find(
        (m) => m.id === source.event || m.aliases?.includes(source.event),
      );
      if (
        data.eventFound !== true ||
        !/^chat-[a-f0-9]{24}$/.test(data.id) ||
        !message ||
        !["dialogue", "tool"].includes(message.kind) ||
        typeof message.text !== "string" ||
        !message.text.includes(source.quote)
      )
        throw new WikiError(
          "EVIDENCE_MISMATCH",
          "Evidence quote does not match a recorded dialogue or tool event",
        );
      records.push({
        conversation: data.id,
        event: message.id,
        quote: source.quote,
        attribution: message.role,
        session_start: data.start,
        event_at: message.timestamp || null,
        order: message.order,
        snapshot: message.snapshot || data.snapshot,
        line: message.line,
        url: `/conversations/${data.id}/#${encodeURIComponent(message.id)}`,
      });
    }
    verified.set(update.id, {
      input: JSON.stringify(update.evidence),
      records,
    });
  }
  return verified;
}
