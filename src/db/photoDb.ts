import type { StoredPhoto } from "../types/Photo";

const DB_NAME = "box-photo-uploader-db";
const DB_VERSION = 1;
const STORE_NAME = "photos";

function requestToPromise<T>(
    request: IDBRequest<T>
): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function openPhotoDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                });

                store.createIndex("status", "status");
                store.createIndex("createdAt", "createdAt");
            }
        };

        request.onsuccess = () => resolve(request.result);

        request.onerror = () => {
            reject(request.error);
        };
    });
}

export async function savePhotos(
    photos: StoredPhoto[]
): Promise<void> {
    const db = await openPhotoDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        photos.forEach((photo) => {
            store.put(photo);
        });

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };

        transaction.onabort = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

export async function getAllPhotos(): Promise<StoredPhoto[]> {
    const db = await openPhotoDb();

    try {
        const transaction = db.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(STORE_NAME);
        const photos = await requestToPromise(store.getAll());

        return photos.sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
        );
    } finally {
        db.close();
    }
}

export async function deletePhoto(
    id: string
): Promise<void> {
    const db = await openPhotoDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        transaction.objectStore(STORE_NAME).delete(id);

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
    });
}