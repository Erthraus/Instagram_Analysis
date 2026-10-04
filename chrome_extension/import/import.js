/**
 * import.js — Import a legacy (v0) data file as the baseline for a
 * retroactive follower diff. The next sync compares it with the live lists.
 */

import { sanitizeLegacyBaseline } from "../utils/analyzer.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const I18N = {
    tr: {
        desc:    "Eski masaüstü uygulamasının veri dosyasını seç (<kullanıcı>_data.json). Dosya bu tarayıcıda kalır.",
        success: (count, date) => `${count} takipçi yüklendi (${date}). Şimdi eklentiden Sync'e bas: o tarihten bugüne takipten çıkanlar "Çıkanlar" sekmesinde görünecek.`,
        failure: (reason) => `Dosya yüklenemedi: ${reason}`,
        tooBig:  "Dosya çok büyük.",
    },
    en: {
        desc:    "Choose the data file of the old desktop app (<username>_data.json). The file stays in this browser.",
        success: (count, date) => `${count} followers loaded (${date}). Now press Sync in the extension: everyone who unfollowed since that date will appear under "Lost".`,
        failure: (reason) => `Could not load the file: ${reason}`,
        tooBig:  "File is too large.",
    },
};

const { popup_lang } = await chrome.storage.local.get(["popup_lang"]);
const t = I18N[popup_lang] || I18N.tr;

const result = document.getElementById("import-result");
document.getElementById("import-desc").textContent = t.desc;

document.getElementById("file-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
        if (file.size > MAX_FILE_BYTES) throw new Error(t.tooBig);
        const baseline = sanitizeLegacyBaseline(JSON.parse(await file.text()));
        await chrome.storage.local.set({ legacy_baseline: baseline });
        result.textContent = t.success(baseline.followers_list.length, baseline.timestamp);
    } catch (err) {
        result.textContent = t.failure(err.message);
    }
});
