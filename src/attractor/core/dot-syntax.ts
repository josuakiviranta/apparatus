import type { SourceLocation } from "../types.js";

export class DotSyntaxError extends Error {
  readonly location: SourceLocation;
  constructor(message: string, location: SourceLocation) {
    super(message);
    this.name = "DotSyntaxError";
    this.location = location;
  }
}
