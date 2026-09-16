// Stable machine-readable failures across the writer subprocess boundary.
export class WikiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
