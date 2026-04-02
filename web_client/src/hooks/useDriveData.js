import { useState, useEffect, useCallback, useRef } from "react";
import { listSnapshots, loadSnapshotById, deleteSnapshot } from "../utils/driveApi.js";

const REFRESH_COOLDOWN_MS = 5000; // 5 seconds between refreshes

/**
 * useDriveData — Fetches Analytics_Snapshot_{userId}.json from Drive.
 * Supports multiple Instagram accounts via account switching and deletion.
 */
export function useDriveData(token) {
    const [accounts, setAccounts]       = useState([]); // [{ id, userId, modifiedTime, currentUser }]
    const [selectedId, setSelectedId]   = useState(null); // Drive file ID
    const [snapshot, setSnapshot]       = useState(null);
    const [modifiedTime, setModifiedTime] = useState(null);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [refreshKey, setRefreshKey]   = useState(0);
    const lastRefreshAt                 = useRef(0);

    useEffect(() => {
        if (!token) return;
        setLoading(true);
        setError(null);

        listSnapshots(token)
            .then(async (files) => {
                if (files.length === 0) {
                    setAccounts([]);
                    setSnapshot(null);
                    setModifiedTime(null);
                    return;
                }

                // Pick: previously selected, or most recent
                const targetFile = files.find(f => f.id === selectedId) || files[0];

                const data = await loadSnapshotById(token, targetFile.id);

                // Build accounts list, enriching with username from snapshot if available
                const enriched = files.map(f => ({
                    ...f,
                    username: f.id === targetFile.id
                        ? (data.currentUser?.username || f.userId)
                        : f.userId
                }));
                setAccounts(enriched);
                setSelectedId(targetFile.id);
                setSnapshot(data);
                setModifiedTime(targetFile.modifiedTime);
            })
            .catch(err => setError(err.message || "Drive yükleme hatası."))
            .finally(() => setLoading(false));

    }, [token, refreshKey]); // intentionally exclude selectedId — handled by switchAccount

    const refresh = useCallback(() => {
        const now = Date.now();
        if (now - lastRefreshAt.current < REFRESH_COOLDOWN_MS) return;
        lastRefreshAt.current = now;
        setRefreshKey(k => k + 1);
    }, []);

    const switchAccount = useCallback(async (fileId) => {
        if (!token || fileId === selectedId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await loadSnapshotById(token, fileId);
            const file = accounts.find(f => f.id === fileId);
            setSelectedId(fileId);
            setSnapshot(data);
            setModifiedTime(file?.modifiedTime || null);
            setAccounts(prev => prev.map(f =>
                f.id === fileId
                    ? { ...f, username: data.currentUser?.username || f.userId }
                    : f
            ));
        } catch (err) {
            setError(err.message || "Hesap yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, [token, selectedId, accounts]);

    const deleteAccount = useCallback(async (fileId) => {
        if (!token || !fileId) return;
        setLoading(true);
        setError(null);
        try {
            await deleteSnapshot(token, fileId);
            const remaining = accounts.filter(f => f.id !== fileId);
            setAccounts(remaining);

            if (remaining.length === 0) {
                setSelectedId(null);
                setSnapshot(null);
                setModifiedTime(null);
            } else if (fileId === selectedId) {
                // Deleted the currently viewed account — switch to first remaining
                const next = remaining[0];
                const data = await loadSnapshotById(token, next.id);
                setSelectedId(next.id);
                setSnapshot(data);
                setModifiedTime(next.modifiedTime || null);
                setAccounts(prev => prev.map(f =>
                    f.id === next.id
                        ? { ...f, username: data.currentUser?.username || f.userId }
                        : f
                ));
            }
        } catch (err) {
            setError(err.message || "Silme başarısız.");
        } finally {
            setLoading(false);
        }
    }, [token, selectedId, accounts]);

    return { snapshot, modifiedTime, accounts, selectedId, loading, error, refresh, switchAccount, deleteAccount };
}
