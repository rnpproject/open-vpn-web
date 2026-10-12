import "server-only";
import type { NoSQLClient } from "oracle-nosqldb";
import { getEnv } from "@/lib/env";

type Document = Record<string, unknown>;
type MutationResult<T> =
  { write: true; payload: Document; result: T } | { write: false; result: T };

let clientPromise: Promise<NoSQLClient> | undefined;
const CAS_ATTEMPTS = 20;

function getClient(): Promise<NoSQLClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const env = getEnv();
      if (!env.ORACLE_NOSQL_REGION)
        throw new Error("ORACLE_NOSQL_REGION wajib diisi untuk Oracle NoSQL Database.");
      const { NoSQLClient } = await import("oracle-nosqldb");
      const hasInlineCredentials = Boolean(
        env.ORACLE_NOSQL_TENANT_ID &&
        env.ORACLE_NOSQL_USER_ID &&
        env.ORACLE_NOSQL_FINGERPRINT &&
        env.ORACLE_NOSQL_PRIVATE_KEY,
      );
      return new NoSQLClient({
        region: env.ORACLE_NOSQL_REGION,
        ...(env.ORACLE_NOSQL_COMPARTMENT ? { compartment: env.ORACLE_NOSQL_COMPARTMENT } : {}),
        auth: {
          iam: {
            ...(hasInlineCredentials
              ? {
                  tenantId: env.ORACLE_NOSQL_TENANT_ID,
                  userId: env.ORACLE_NOSQL_USER_ID,
                  fingerprint: env.ORACLE_NOSQL_FINGERPRINT,
                  privateKey: env.ORACLE_NOSQL_PRIVATE_KEY.replace(/\\n/g, "\n"),
                  ...(env.ORACLE_NOSQL_PASSPHRASE
                    ? { passphrase: env.ORACLE_NOSQL_PASSPHRASE }
                    : {}),
                }
              : {
                  ...(env.ORACLE_NOSQL_CONFIG_FILE
                    ? { configFile: env.ORACLE_NOSQL_CONFIG_FILE }
                    : {}),
                  profileName: env.ORACLE_NOSQL_PROFILE,
                }),
          },
        },
      });
    })();
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }
  return clientPromise;
}

function tableName(): string {
  return getEnv().ORACLE_NOSQL_TABLE;
}

function isDocument(value: unknown): value is Document {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function getOracleDocument(
  collectionType: string,
  documentId: string,
): Promise<Document | undefined> {
  const client = await getClient();
  const result = await client.get(tableName(), {
    collection_type: collectionType,
    document_id: documentId,
  });
  return isDocument(result.row?.payload) ? result.row.payload : undefined;
}

export async function updateOracleDocument<T>(
  collectionType: string,
  documentId: string,
  update: (current: Document | undefined) => MutationResult<T>,
  ttlDays?: number,
): Promise<T> {
  const client = await getClient();
  const table = tableName();
  const key = { collection_type: collectionType, document_id: documentId };

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const existing = await client.get(table, key);
    const current = isDocument(existing.row?.payload) ? existing.row.payload : undefined;
    if (existing.row && !existing.version)
      throw new Error("Oracle NoSQL did not return a row version for a conditional update.");
    const mutation = update(current);
    if (!mutation.write) return mutation.result;

    const options = {
      ...(existing.version ? { matchVersion: existing.version } : { ifAbsent: true }),
      ...(ttlDays === undefined ? {} : { ttl: ttlDays }),
    };
    const result = await client.put(table, { ...key, payload: mutation.payload }, options);
    if (result.success) return mutation.result;
  }

  throw new Error(
    `Oracle NoSQL document contention exceeded retry limit (${collectionType}/${documentId}).`,
  );
}
