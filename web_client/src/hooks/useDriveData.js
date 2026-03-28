import { useState, useEffect, useCallback } from "react";
import { listSnapshots, loadSnapshotById } from "../utils/driveApi.js";

/**
 * useDriveData — Fetches Analytics_Snapshot_{userId}.json from Drive.
 * Supports multiple Instagram accounts via account switching.
 */
export function useDriveData(token) {
    const [accounts, setAccounts]       = useState([]); // [{ id, userId, modifiedTime, currentUser }]
    const [selectedId, setSelectedId]   = useState(null); // Drive file ID
    const [snapshot, setSnapshot]       = useState(null);
    const [modifiedTime, setModifiedTime] = useState(null);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [refreshKey, setRefreshKey]   = useState(0);

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

    const refresh = () => setRefreshKey(k => k + 1);

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
            // Update username in accounts list now that we have the snapshot
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

    return { snapshot, modifiedTime, accounts, selectedId, loading, error, refresh, switchAccount };
}
