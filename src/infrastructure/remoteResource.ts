export type RemotePayload = Readonly<Record<string, unknown>>;

export type RemoteResource = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: RemotePayload | null;
}>;

export type RemoteResourceParseResult =
  | Readonly<{ ok: true; value: RemoteResource }>
  | Readonly<{ ok: false; error: 'contract' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida únicamente el sobre publicado por el backend. La validación de los
 * campos propios de una incidencia se realiza después, al convertir el DTO en
 * un objeto que pueda utilizar la aplicación.
 */
export function parseRemoteResource(input: unknown): RemoteResourceParseResult {
  if (!isRecord(input)) {
    return { ok: false, error: 'contract' };
  }

  const { id, version, status, payload } = input;
  const validPayload = payload === null || isRecord(payload);

  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    !Number.isInteger(version) ||
    (version as number) < 0 ||
    typeof status !== 'string' ||
    status.trim().length === 0 ||
    !validPayload
  ) {
    return { ok: false, error: 'contract' };
  }

  // Se copian sólo los campos conocidos para ignorar extensiones futuras del DTO.
  return {
    ok: true,
    value: {
      id,
      version: version as number,
      status,
      payload,
    },
  };
}
