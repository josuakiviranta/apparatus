export interface ResolvedInput {
  /** original declaration, e.g. "verifier.summary" or "project" */
  name: string;
  /** true iff name contains a dot */
  qualified: boolean;
  /** node id portion when qualified, else undefined */
  sourceNode: string | undefined;
  /** key portion (after dot if qualified, else the bare name) */
  localKey: string;
  /** key used to look up in ctx.values (same as `name` for qualified, bare key for caller/system) */
  lookupKey: string;
  /** XML tag name in rendered Inputs block (dot replaced by underscore) */
  renderedTag: string;
  /** node-attribute key used as fallback (e.g. default_summary) */
  fallbackAttr: string;
}

export function resolveInputDecl(decl: string): ResolvedInput {
  if (typeof decl !== "string" || decl.trim() === "") {
    throw new Error(`resolveInputDecl: empty declaration`);
  }
  const trimmed = decl.trim();
  const dotCount = (trimmed.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    throw new Error(
      `resolveInputDecl: multi-segment keys are not allowed: "${trimmed}". ` +
      `Inputs are at most one-dot qualified (e.g. "node.key").`,
    );
  }
  if (dotCount === 1) {
    const [sourceNode, localKey] = trimmed.split(".");
    if (!sourceNode || !localKey) {
      throw new Error(`resolveInputDecl: malformed qualified key "${trimmed}"`);
    }
    return {
      name: trimmed,
      qualified: true,
      sourceNode,
      localKey,
      lookupKey: trimmed,
      renderedTag: `${sourceNode}_${localKey}`,
      fallbackAttr: `default_${localKey}`,
    };
  }
  return {
    name: trimmed,
    qualified: false,
    sourceNode: undefined,
    localKey: trimmed,
    lookupKey: trimmed,
    renderedTag: trimmed,
    fallbackAttr: `default_${trimmed}`,
  };
}
