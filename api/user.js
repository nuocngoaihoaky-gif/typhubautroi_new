import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// Cấu hình game
const DEFAULT_REF_UID = '8065435277'; 
const REF_PREFIX = '000000';          
const REGEN_RATE = 3;                 
const DAILY_REWARDS_LENGTH = 10; 

// Helper lấy ngày giờ VN
function getVNDateString(timestamp) {
    if (!timestamp) return '';
    const vnTime = new Date(timestamp + 25200000); // UTC+7
    return vnTime.toISOString().split('T')[0];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        const now = Date.now();
        
        // 🔥 Chạy song song
        const [userSnap, walletSnap] = await Promise.all([
            userRef.get(),
            walletRef.once('value')
        ]);

        let firestoreData = userSnap.exists ? userSnap.data() : null;
        let walletData = walletSnap.val();

        // =========================================================
        // TRƯỜNG HỢP 1: USER CŨ
        // =========================================================
        if (firestoreData) {
            // Migration ví (nếu thiếu)
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

            // Tính năng lượng hồi (Visual only)
            const lastUpdate = walletData.last_energy_update || now;
            const maxEnergy = walletData.baseMaxEnergy || 1000;
            let currentEnergy = walletData.energy || 0;
            const elapsed = Math.floor((now - lastUpdate) / 1000);
            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
            }

            // =========================================================
            // 🔥 LOGIC TÍNH STREAK (Server tự reset nếu đứt)
            // =========================================================
            const todayStr = getVNDateString(now);
            const yesterdayStr = getVNDateString(now - 86400000);
            
            const lastDate = firestoreData.last_daily_date || "";
            let currentStreak = firestoreData.daily_streak || 0;

            // Logic 1: Đứt chuỗi (Last date ko phải hôm qua và ko phải hôm nay) -> Reset 0
            if (lastDate !== todayStr && lastDate !== yesterdayStr) {
                currentStreak = 0;
            }

            // Logic 2: Hết vòng (Đã xong 10 ngày và last date là hôm qua) -> Reset 0
            if (currentStreak >= DAILY_REWARDS_LENGTH && lastDate === yesterdayStr) {
                currentStreak = 0;
            }

            return res.status(200).json({
                id: uid,
                username: firestoreData.username || tgUser.first_name,
                
                // Realtime DB
                balance: walletData.balance || 0,
                diamond: walletData.diamond || 0,
                energy: currentEnergy,
                baseMaxEnergy: maxEnergy,
                nextRefillAt: walletData.nextRefillAt || 0,
                
                // Firestore Data
                level: firestoreData.level || 1,
                exp: firestoreData.exp || 0,
                multitapLevel: firestoreData.multitapLevel || 1,
                energyLimitLevel: firestoreData.energyLimitLevel || 1,
                investments: firestoreData.investments || {},
                bank_info: firestoreData.bank_info || null,
                ref_by: firestoreData.ref_by || null,

                // Social Fields
                inviteCount: firestoreData.invite_count || 0,
                totalInviteDiamond: firestoreData.total_invite_diamond || 0,
                completedTasks: firestoreData.completed_tasks || [],
                withdrawHistory: firestoreData.withdrawHistory || [],
                
                // Daily Checkin (Đã tính toán lại Streak)
                dailyStreak: currentStreak,
                lastDailyDate: lastDate, // Trả về để client tự check isClaimedToday nếu cần

                server_time: now
            });
        }

        // =========================================================
        // TRƯỜNG HỢP 2: USER MỚI (TẠO ACC)
        // =========================================================
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');
        
        if (!refUid || refUid === uid || isNaN(Number(refUid))) {
            refUid = DEFAULT_REF_UID;
        }
        let finalRefBy = DEFAULT_REF_UID;
        if (refUid !== DEFAULT_REF_UID) {
            const refUser = await db.collection('users').doc(refUid).get();
            if (refUser.exists) {
                finalRefBy = REF_PREFIX + refUid; 
            } else {
                finalRefBy = DEFAULT_REF_UID;
            }
        }

        const batch = db.batch();

        const newFirestoreData = {
            id: uid,
            telegram_id: Number(uid),
            username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
            ref_by: finalRefBy,
            
            // Stats
            level: 1, exp: 0, multitapLevel: 1, tapValue: 1, energyLimitLevel: 1,
            investments: {}, bank_info: null,

            // Social & Daily
            invite_count: 0,
            total_invite_diamond: 0,
            completed_tasks: [],
            withdrawHistory: [],
            daily_streak: 0,
            last_daily_date: null, 

            created_at: FieldValue.serverTimestamp()
        };
        batch.set(userRef, newFirestoreData);

        const newWalletData = {
            balance: 0, diamond: 50000, energy: 1000, baseMaxEnergy: 1000,
            last_energy_update: now, nextRefillAt: 0
        };
        await walletRef.set(newWalletData); 

        await batch.commit();

        return res.status(200).json({
            ...newFirestoreData,
            
            // Map keys
            inviteCount: 0,
            totalInviteDiamond: 0,
            completedTasks: [],
            withdrawHistory: [],
            dailyStreak: 0,
            lastDailyDate: null,

            ...newWalletData,
            server_time: now
        });

    } catch (e) {
        console.error('User API Error:', e);
        return res.status(500).json({ error: 'Lỗi đăng nhập' });
    }
}
