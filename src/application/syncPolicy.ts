export type JsonObject = Readonly<Record<string, unknown>>;
export type SyncRecord = Readonly<{ id: string; version: number; fields: JsonObject }>;

const MISSING = Symbol('missing');

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;

    const entries = Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(object[key])}`,
      );

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? String(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === MISSING || b === MISSING) {
    return a === b;
  }

  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Week 08: performs a three-way merge of base, local and remote fields.
 * Conflicting fields are returned in alphabetical order.
 * The input records are never modified.
 */
export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): Readonly<
  | { kind: 'merged'; fields: JsonObject }
  | { kind: 'conflict'; fields: readonly string[] }
> {
  const fieldNames = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const field of [...fieldNames].sort()) {
    const baseValue = Object.prototype.hasOwnProperty.call(
      base.fields,
      field,
    )
      ? base.fields[field]
      : MISSING;

    const localValue = Object.prototype.hasOwnProperty.call(
      local.fields,
      field,
    )
      ? local.fields[field]
      : MISSING;

    const remoteValue = Object.prototype.hasOwnProperty.call(
      remote.fields,
      field,
    )
      ? remote.fields[field]
      : MISSING;

    let selected: unknown;

    // If local did not change the field, take the remote value.
    if (sameJson(localValue, baseValue)) {
      selected = remoteValue;
    }
    // If remote did not change the field, preserve the local value.
    else if (sameJson(remoteValue, baseValue)) {
      selected = localValue;
    }
    // If both sides made the same change, keep that value.
    else if (sameJson(localValue, remoteValue)) {
      selected = localValue;
    }
    // Both sides changed the field differently.
    else {
      conflicts.push(field);
      continue;
    }

    if (selected !== MISSING) {
      merged[field] = selected;
    }
  }

  if (conflicts.length > 0) {
    return {
      kind: 'conflict',
      fields: conflicts,
    };
  }

  return {
    kind: 'merged',
    fields: merged,
  };
}

/**
 * Week 08: keeps the first occurrence of each operationId.
 * Preserves input order and does not modify the input array.
 */
export function deduplicateOperations<
  T extends Readonly<{ operationId: string }>,
>(operations: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const operation of operations) {
    if (seen.has(operation.operationId)) {
      continue;
    }

    seen.add(operation.operationId);
    result.push(operation);
  }

  return result;
}


/** Status and assignment form one semantic unit: starting and reassigning conflict. */
export function incidentSyncRecord(incident: import('../domain/offlineStore').VersionedIncident): SyncRecord {
  const { id, version, status, assignedTechnicianId, ...fields } = incident;
  return { id, version, fields: { ...fields, work: { status, assignedTechnicianId } } };
}
