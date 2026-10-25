New-Item -ItemType Directory -Force docs | Out-Null

@'
# Week 08 — Offline Synchronization Policy

## 1. Purpose

Define how locally stored incident operations are synchronized with the
remote service while preserving operation identity, authorization and
concurrent changes.

## 2. Operation identity and idempotency

Each pending operation has a stable `operationId`. The same identifier
must be reused when retrying an operation. A retry must not generate a
new identifier, because a timeout may occur after the server has already
committed the operation.

The server is responsible for recognizing repeated requests with the
same idempotency key. Reusing a key with a different request payload
must be treated as an error.

## 3. Synchronization procedure

1. Read the pending operations from the local store.
2. Deduplicate repeated entries by `operationId`, preserving the first
   occurrence and the original order.
3. Verify that the operation's `actorId` matches the active session.
4. Validate that the action and its required payload are supported.
5. Send the operation with its original `baseVersion` and
   `operationId`.
6. Validate the response identity and the returned server version.
7. Remove the operation only after a valid confirmation has been
   received and processed by the local store.

An operation must not be removed merely because a request was sent.

## 4. Conflict policy

The server's version check is authoritative for state-changing actions.
A version conflict must be reported and must not be treated as a
successful synchronization.

For field-level reconciliation, compare the base, local and remote
values:

- If local is unchanged from base, accept the remote value.
- If remote is unchanged from base, preserve the local value.
- If local and remote contain the same change, accept that value.
- If both changed the field differently, report a conflict.

A conflict must be resolved explicitly; the client must not silently
overwrite either side. Input records must remain unmodified.

## 5. Retry policy

Network failures and timeouts leave the operation pending. The server
may have committed an operation before the client timed out, so retries
must use the original `operationId`.

Authentication or authorization failures must not be reported as
successful operations. A version conflict requires reconciliation
rather than an unconditional retry with a new identity.

Retries should be bounded or delayed by the synchronization coordinator
to avoid excessive requests.

## 6. Local persistence and evidence

Pending operations must survive closing and reopening the local store.
A confirmation must match the operation identity, incident identity,
actor and a valid newer server version before the operation is removed.

Photo references remain pending until a separate supported upload and
confirmation flow completes. Confirming an incident action does not,
by itself, prove that its photos were uploaded.

## 7. Known limitations

The synchronization engine does not claim that pending photo references
have been uploaded. A timeout can leave the client uncertain until a
retry with the same idempotency key obtains a definitive response.
Native Expo SQLite behavior on a physical Android or iOS device must be
verified separately if it has not been tested on-device.
'@ | Set-Content -Encoding utf8 docs\sync-policy.md