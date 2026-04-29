import { z, type ZodObject, type ZodTypeAny } from "zod";
import type { JsonSchemaFragment } from "./agent.js";

const ALLOWED_KEYS_OBJECT = new Set(["type", "enum", "items", "maxLength", "description"]);

function fragmentToZod(key: string, frag: JsonSchemaFragment): ZodTypeAny {
  if (typeof frag === "string") {
    switch (frag) {
      case "string": return z.string();
      case "number": return z.number();
      case "boolean": return z.boolean();
      default:
        throw new Error(`outputs[${key}]: unsupported fragment shape (shorthand "${frag}"). Supported shorthands: string, number, boolean.`);
    }
  }
  const obj = frag as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter(k => !ALLOWED_KEYS_OBJECT.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(`outputs[${key}]: unsupported fragment shape (unknown keys: ${unknownKeys.join(", ")}). Supported: type (string|number|boolean|array), enum, items, maxLength, description, nullable form ([type, "null"]).`);
  }
  if (Array.isArray(obj.enum)) {
    const values = obj.enum.map(String);
    return z.enum(values as [string, ...string[]]);
  }
  if (obj.type === "array") {
    const items = obj.items;
    if (typeof items !== "string") {
      throw new Error(`outputs[${key}]: array requires items: <primitive type>`);
    }
    const inner = fragmentToZod(`${key}.items`, items as JsonSchemaFragment);
    return z.array(inner);
  }
  if (Array.isArray(obj.type) && obj.type.length === 2 && obj.type.includes("null")) {
    const realType = obj.type.find(t => t !== "null") as string;
    const inner = fragmentToZod(`${key}.nullable`, realType as JsonSchemaFragment);
    return inner.nullable();
  }
  if (obj.type === "string") {
    let s = z.string();
    if (typeof obj.maxLength === "number") s = s.max(obj.maxLength);
    return s;
  }
  if (obj.type === "number") return z.number();
  if (obj.type === "boolean") return z.boolean();

  throw new Error(`outputs[${key}]: unsupported fragment shape (type=${JSON.stringify(obj.type)}). Supported: type (string|number|boolean|array), enum, items, maxLength, description, nullable form ([type, "null"]).`);
}

export function outputsToZod(
  outputs: Record<string, JsonSchemaFragment>,
): ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, frag] of Object.entries(outputs)) {
    shape[key] = fragmentToZod(key, frag);
  }
  return z.object(shape).strict();
}
