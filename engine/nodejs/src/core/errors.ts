// Engine-level outcomes raised as typed errors and mapped to Interface responses.

export class ElementRejected extends Error {
  constructor(public violations: string[]) {
    super(violations.join("; "));
    this.name = "ElementRejected";
  }
}
export class NotFound extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFound";
  }
}
export class NameTaken extends Error {
  constructor(message = "Name taken") {
    super(message);
    this.name = "NameTaken";
  }
}
export class InvalidDefinition extends Error {
  constructor(message = "The name or description is blank.") {
    super(message);
    this.name = "InvalidDefinition";
  }
}
export class StillReferenced extends Error {
  constructor(message = "Still referenced") {
    super(message);
    this.name = "StillReferenced";
  }
}
export class NoSuchRevision extends Error {
  constructor(message = "No such revision") {
    super(message);
    this.name = "NoSuchRevision";
  }
}
