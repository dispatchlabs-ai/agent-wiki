// Compile-time regressions: the expected errors must remain errors.
/** @type {import("../../public/edit-contract.js").ArticleReceipt} */
// @ts-expect-error Newly persisted article receipts require revision_id.
const missingRevision = { id: "article", number: 1, url: "/wiki/article/" };
/** @type {import("../../src/contracts.mjs").WorkerMessage} */
// @ts-expect-error Worker success must include cache byte accounting.
const missingSize = { type: "result", result: null };
export { missingRevision, missingSize };
