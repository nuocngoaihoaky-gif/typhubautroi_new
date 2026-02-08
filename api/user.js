import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// Cấu hình game
const DEFAULT_REF_UID = '8065435277'; // UID Admin
const REF_PREFIX = '000000';          // Tiền tố mã mời chưa kích hoạt
const REGEN_RATE = 3;                 // Tốc độ hồi năng lượng

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực (Dùng hàm từ _lib.js)
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // 🔥 Chạy song song 2 Database
        const [userSnap, walletSnap] = await Promise.all([
            userRef.get(),
            walletRef.once('value')
        ]);

        const now = Date.now();
        let firestoreData = userSnap.exists ? userSnap.data() : null;
        let walletData = walletSnap.val();

        // =========================================================
        // TRƯỜNG HỢP 1: USER CŨ (ĐÃ CÓ TÀI KHOẢN)
        // =========================================================
        if (firestoreData) {
            // 🛠 TỰ ĐỘNG MIGRATION: Nếu chưa có ví RTDB thì tạo
            if (!walletData) {
                walletData = {
                    balance: firestoreData.balance || 0,
                    diamond: 0,
                    energy: 1000,
                    baseMaxEnergy: 1000, 
                    last_energy_update: now
                };
                await walletRef.set(walletData);
            }

            // --- Tính năng lượng hồi (Visual only) ---
            const lastUpdate = walletData.last_energy_update || now;
            const maxEnergy = walletData.baseMaxEnergy || 1000;
            let currentEnergy = walletData.energy || 0;
            const elapsed = Math.floor((now - lastUpdate) / 1000);

            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
            }

            return res.status(200).json({
                id: uid,
                username: firestoreData.username || tgUser.first_name,
                
                // Realtime DB
                balance: walletData.balance || 0,
                diamond: walletData.diamond || 0,
                energy: currentEnergy,
                baseMaxEnergy: maxEnergy,
                
                // Firestore
                level: firestoreData.level || 1,
                exp: firestoreData.exp || 0,
                multitapLevel: firestoreData.multitapLevel || 1,
                energyLimitLevel: firestoreData.energyLimitLevel || 1,
                investments: firestoreData.investments || {},
                bank_info: firestoreData.bank_info || null,
                
                // 🔥 Ref info nằm ở đây
                ref_by: firestoreData.ref_by || null,

                nextRefillAt: walletData.nextRefillAt || 0,
                server_time: now
            });
        }

        // =========================================================
        // TRƯỜNG HỢP 2: USER MỚI (TẠO ACC)
        // =========================================================
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');
        
        // Validate Ref ID
        if (!refUid || refUid === uid || isNaN(Number(refUid))) {
            refUid = DEFAULT_REF_UID;
        }
        
        let finalRefBy = DEFAULT_REF_UID;
        
        // Check người mời có tồn tại không
        if (refUid !== DEFAULT_REF_UID) {
            const refUser = await db.collection('users').doc(refUid).get();
            if (refUser.exists) {
                // ✅ Lưu prefix 000000 để đánh dấu chưa kích hoạt
                finalRefBy = REF_PREFIX + refUid;
            } else {
                finalRefBy = DEFAULT_REF_UID;
            }
        }

        const batch = db.batch();

        // 1. Tạo Profile (Firestore) - 🔥 LƯU REF_BY Ở ĐÂY
        const newFirestoreData = {
            id: uid,
            telegram_id: Number(uid),
            username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
            
            ref_by: finalRefBy, // <--- Đã chuyển qua đây đúng ý bạn
            
            level: 1,
            exp: 0,
            multitapLevel: 1,
            tapValue: 1,
            energyLimitLevel: 1,
            investments: {},
            bank_info: null,
            created_at: FieldValue.serverTimestamp()
        };
        batch.set(userRef, newFirestoreData);

        // 2. Tạo Social (Firestore) - Không lưu ref_by nữa
        const socialRef = db.collection('user_social').doc(uid);
        batch.set(socialRef, {
            invite_count: 0,
            total_invite_earned: 0,
            completed_tasks: [],
            withdrawHistory: [],
            daily_streak: 0,
            last_daily_date: null
        });

        // 3. Tạo Ví (Realtime DB) - 🔥 QUÀ TÂN THỦ MỚI
        const newWalletData = {
            balance: 0,      // 🟡 Vàng: 0
            diamond: 50000,  // 💎 Kim cương: 50,000
            energy: 1000,
            baseMaxEnergy: 1000,
            last_energy_update: now,
            nextRefillAt: 0
        };
        await walletRef.set(newWalletData); 

        // 4. Chốt đơn
        await batch.commit();

        return res.status(200).json({
            ...newFirestoreData,
            ...newWalletData,
            server_time: now
        });

    } catch (e) {
        console.error('User API Error:', e);
        return res.status(500).json({ error: 'Lỗi đăng nhập' });
    }
}
