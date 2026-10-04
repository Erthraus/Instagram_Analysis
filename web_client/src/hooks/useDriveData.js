import { useState, useEffect, useCallback, useRef } from "react";
import { listSnapshots, loadSnapshotById, deleteSnapshot, loadAvatars } from "../utils/driveApi.js";

const REFRESH_COOLDOWN_MS = 5000;

/**
 * useDriveData — fetches a v3 snapshot + matching avatars file from Drive.
 */
export function useDriveData(token) {
    const [accounts, setAccounts]         = useState([]);
    const [selectedId, setSelectedId]     = useState(null);
    const [snapshot, setSnapshot]         = useState(null);
    const [avatars, setAvatars]           = useState({});       // { pk: dataURI }
    const [modifiedTime, setModifiedTime] = useState(null);
    const [loading, setLoading]           = useState(false);
    const [error, setError]               = useState(null);
    const [refreshKey, setRefreshKey]     = useState(0);
    const lastRefreshAt                   = useRef(0);

    useEffect(() => {
        if (!token) return;
        setLoading(true);
        setError(null);

        listSnapshots(token)
            .then(async (files) => {
                if (files.length === 0) {
                    setAccounts([]);
                    setSnapshot(null);
                    setAvatars({});
                    setModifiedTime(null);
                    return;
                }

                const targetFile = files.find(f => f.id === selectedId) || files[0];
                const data = await loadSnapshotById(token, targetFile.id);
                const avs  = await loadAvatars(token, targetFile.userId).catch(() => null);

                const enriched = files.map(f => ({
                    ...f,
                    username: f.id === targetFile.id
                        ? (data?.account?.username || f.userId)
                        : f.userId,
                }));
                setAccounts(enriched);
                setSelectedId(targetFile.id);
                setSnapshot(data);
                setAvatars(avs || {});
                setModifiedTime(targetFile.modifiedTime);
            })
            .catch(err => setError(err.message || "Drive yükleme hatası."))
            .finally(() => setLoading(false));
    }, [token, refreshKey]);

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
            const avs  = await loadAvatars(token, file?.userId).catch(() => null);
            setSelectedId(fileId);
            setSnapshot(data);
            setAvatars(avs || {});
            setModifiedTime(file?.modifiedTime || null);
            setAccounts(prev => prev.map(f =>
                f.id === fileId
                    ? { ...f, username: data?.account?.username || f.userId }
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
                setAvatars({});
                setModifiedTime(null);
            } else if (fileId === selectedId) {
                const next = remaining[0];
                const data = await loadSnapshotById(token, next.id);
                const avs  = await loadAvatars(token, next.userId).catch(() => null);
                setSelectedId(next.id);
                setSnapshot(data);
                setAvatars(avs || {});
                setModifiedTime(next.modifiedTime || null);
                setAccounts(prev => prev.map(f =>
                    f.id === next.id
                        ? { ...f, username: data?.account?.username || f.userId }
                        : f
                ));
            }
        } catch (err) {
            setError(err.message || "Silme başarısız.");
        } finally {
            setLoading(false);
        }
    }, [token, selectedId, accounts]);

    return { snapshot, avatars, modifiedTime, accounts, selectedId, loading, error, refresh, switchAccount, deleteAccount };
}
