// Shared browser discovery and writer limits. Validation remains server-side.
/**
 * @typedef {object} ArticleUpdate
 * @property {string} id
 * @property {string|null} expected_revision_id
 * @property {string} title
 * @property {string} description
 * @property {string} topic
 * @property {string} body
 * @property {string} summary
 * @property {string[]} [related]
 * @property {string[]} [questions]
 * @property {{conversation:string,event:string,quote:string}[]} [evidence]
 * @property {object[]} [edits] Targeted changes applied to the current body.
 * @property {boolean} [delete] Removes the article and repairs links to it.
 * @property {string} [replace_with] Article that receives repaired links.
 * @typedef {{operation_id: string, updates: ArticleUpdate[]}} EditDraft
 * @typedef {{id: string, number: number, url: string, revision_id: string}} ArticleReceipt
 * @typedef {{operation_id:string,state:"saved",articles:ArticleReceipt[],actor?:string,authority?:object,initiator?:string}} StoredReceipt
 * @typedef {{operation_id: string, state: "saved"|"already-saved", articles: ArticleReceipt[], commit: string, actor?:string,authority?:object,initiator?:string, remote?:"not-requested"|"pushed"|"push-failed"}} SaveReceipt
 */
const id = {
  type: "string",
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  maxLength: 100,
};
export const editSchema = {
  type: "object",
  properties: {
    operation_id: id,
    updates: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          id,
          expected_revision_id: { type: ["string", "null"] },
          title: { type: "string", maxLength: 200 },
          description: { type: "string", maxLength: 600 },
          topic: { type: "string", maxLength: 100 },
          body: { type: "string", maxLength: 100000 },
          summary: { type: "string", maxLength: 1000 },
          related: { type: "array", items: id },
          questions: { type: "array", items: { type: "string" } },
          evidence: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                conversation: {
                  type: "string",
                  pattern: "^chat-[a-f0-9]{24}$",
                },
                event: { type: "string", minLength: 1, maxLength: 300 },
                quote: { type: "string", minLength: 1, maxLength: 2500 },
              },
              required: ["conversation", "event", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id",
          "expected_revision_id",
          "title",
          "description",
          "topic",
          "body",
          "summary",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["operation_id", "updates"],
  additionalProperties: false,
};

const summary = { type: "string", minLength: 1, maxLength: 1000 };
export const articleEditSchema = {
  type: "object",
  properties: {
    operation_id: id,
    id,
    summary,
    expected_revision_id: {
      type: "string",
      description:
        "Optional for old_text and append edits; required to replace a section.",
    },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          old_text: { type: "string", minLength: 1 },
          new_text: { type: "string" },
          replace_all: { type: "boolean" },
          section: { type: "string" },
          append: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    title: editSchema.properties.updates.items.properties.title,
    description: editSchema.properties.updates.items.properties.description,
    topic: editSchema.properties.updates.items.properties.topic,
    related: editSchema.properties.updates.items.properties.related,
    questions: editSchema.properties.updates.items.properties.questions,
  },
  required: ["operation_id", "id", "summary"],
  additionalProperties: false,
};
export const articleDeleteSchema = {
  type: "object",
  properties: {
    operation_id: id,
    id,
    summary,
    expected_revision_id: { type: "string" },
    replace_with: id,
  },
  required: ["operation_id", "id", "summary"],
  additionalProperties: false,
};
