const DATABASE = "gif-urself-pending";
const STORE = "recording";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      transaction.onerror = () => reject(transaction.error);
      operation(transaction.objectStore(STORE), resolve, reject);
    });
  } finally {
    database.close();
  }
}

export async function readPending(): Promise<Blob | null> {
  return transact("readonly", (store, resolve, reject) => {
    const request = store.get("current");
    request.onsuccess = () => {
      const value: unknown = request.result;
      resolve(value instanceof Blob ? value : null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writePending(blob: Blob): Promise<void> {
  await transact("readwrite", (store, resolve, reject) => {
    const request = store.put(blob, "current");
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function clearPending(): Promise<void> {
  await transact("readwrite", (store, resolve, reject) => {
    const request = store.delete("current");
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}
