import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

// =================================================
// 🔧 FIREBASE INIT
// =================================================
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const db = getFirestore();

// =================================================
// ⚙️ CONFIG
// =================================================
const DEFAULT_REF_UID = '8065435277';
const REGEN_RATE = 3;               // Năng lượng / giây
const SECRET_PREFIX = '26032007';   // 🔒 Mã đánh dấu user chưa active

// =================================================
// 🚀 MAIN HANDLER
// =================================================
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);

    try {
        const snap = await userRef.get();
        const now = Date.now();

        // =================================================
        // 1️⃣ USER CŨ (LOGIN) - Giữ nguyên
        // =================================================
        if (snap.exists) {
            const data = snap.data();

            // ===== ENERGY REGEN THEO THỜI GIAN =====
            const lastUpdate = data.last_energy_update || now;
            const maxEnergy = data.baseMaxEnergy || 1000;
            let currentEnergy = data.energy || 0;

            const elapsed = Math.floor((now - lastUpdate) / 1000);
            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(
                    currentEnergy + elapsed * REGEN_RATE,
                    maxEnergy
                );
            }

            const nextRefillAt = data.next_refill_at || 0;

            return res.status(200).json({
                id: uid,
                username: data.username,
                balance: data.balance || 0,
                total_earned: data.total_earned || 0,
                energy: currentEnergy,
                baseMaxEnergy: maxEnergy,
                last_energy_update: lastUpdate,
                level: data.level || 1,
                exp: data.exp || 0,
                multitapLevel: data.multitapLevel || 1,
                tapValue: data.tapValue || 1,
                energyLimitLevel: data.energyLimitLevel || 1,
                investments: data.investments || {},
                nextRefillAt: nextRefillAt,
                server_time: now
            });
        }

        // =================================================
        // 2️⃣ USER MỚI (CREATE)
        // =================================================
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');

        // Validate Ref ID cơ bản
        if (!refUid || refUid === uid || isNaN(Number(refUid))) {
            refUid = DEFAULT_REF_UID;
        }

        // Kiểm tra xem người mời có tồn tại không
        let finalRefBy = DEFAULT_REF_UID; // Mặc định là admin

        if (refUid !== DEFAULT_REF_UID) {
            const refSnap = await db.collection('user_social').doc(refUid).get();
            if (refSnap.exists) {
                // ✅ Nếu người mời hợp lệ -> Gắn thêm mã 26032007 vào đầu
                // Ví dụ: refUid là "12345" -> Lưu thành "2603200712345"
                finalRefBy = SECRET_PREFIX + refUid;
            } else {
                finalRefBy = DEFAULT_REF_UID;
            }
        } else {
            // Nếu là ref admin mặc định thì giữ nguyên, không cần gắn mã (hoặc gắn tùy bạn)
            finalRefBy = DEFAULT_REF_UID; 
        }

        const batch = db.batch();

        // ===== USERS CORE =====
        const newCoreData = {
            id: uid,
            telegram_id: Number(uid),
            balance: 500000, // Quà tân thủ
            total_earned: 0,
            level: 1,
            exp: 0,
            energy: 1000,
            baseMaxEnergy: 1000,
            last_energy_update: now,
            multitapLevel: 1,
            tapValue: 1,
            energyLimitLevel: 1,
            investments: {},
            next_refill_at: 0
        };

        batch.set(userRef, newCoreData);

        // ===== USER SOCIAL =====
        const socialRef = db.collection('user_social').doc(uid);
        
        batch.set(socialRef, {
            // 🔥 Lưu ref_by kèm mã bí mật (VD: 26032007123456)
            ref_by: finalRefBy,
            
            // ❌ Đã bỏ cờ ref_status
            
            created_at: FieldValue.serverTimestamp(),
            username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
            invite_count: 0,
            friends: [],
            completed_tasks: [],
            withdrawHistory: []
        });

        await batch.commit();

        return res.status(200).json({
            ...newCoreData,
            created_at: new Date().toISOString(),
            server_time: now
        });

    } catch (e) {
        console.error('User API Error:', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
