import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_REF_UID = '8065435277'; 
const REGEN_RATE = 3;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Auth
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const socialRef = db.collection('user_social').doc(uid); // 🔥 Thêm Social
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        const now = Date.now();

        // 🔥 GỌI SONG SONG 3 NGUỒN DỮ LIỆU (User, Social, Wallet)
        const [userSnap, socialSnap, walletSnap] = await Promise.all([
            userRef.get(),
            socialRef.get(),
            walletRef.once('value')
        ]);

        let userData = userSnap.exists ? userSnap.data() : null;
        let socialData = socialSnap.exists ? socialSnap.data() : null;
        let walletData = walletSnap.val();

        // =========================================================
        // TRƯỜNG HỢP 1: USER CŨ (Đã có data)
        // =========================================================
        if (userData) {
            // Tự fix nếu thiếu Wallet hoặc Social (Migration)
            if (!walletData) {
                walletData = { balance: 0, diamond: 0, energy: 1000, baseMaxEnergy: 1000, last_energy_update: now };
                await walletRef.set(walletData);
            }
            if (!socialData) {
                socialData = { invite_count: 0, total_invite_diamond: 0, completed_tasks: [], withdrawHistory: [], daily_streak: 0 };
                await socialRef.set(socialData);
            }

            // Tính hồi năng lượng
            const lastUpdate = walletData.last_energy_update || now;
            const maxEnergy = walletData.baseMaxEnergy || 1000;
            let currentEnergy = walletData.energy || 0;
            const elapsed = Math.floor((now - lastUpdate) / 1000);
            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
            }

            // 🔥 TRẢ VỀ CỤC DATA KHỔNG LỒ (FULL)
            return res.status(200).json({
                // Core
                id: uid,
                username: userData.username,
                level: userData.level || 1,
                exp: userData.exp || 0,
                
                // Wallet (RTDB)
                balance: walletData.balance || 0,
                diamond: walletData.diamond || 0,
                energy: currentEnergy,
                baseMaxEnergy: maxEnergy,
                
                // Upgrades
                tapValue: userData.tapValue || 1,
                multitapLevel: userData.multitapLevel || 1,
                energyLimitLevel: userData.energyLimitLevel || 1,
                investments: userData.investments || {},
                
                // Social (Firestore)
                inviteCount: socialData.invite_count || 0,
                totalInviteDiamond: socialData.total_invite_diamond || 0,
                completedTasks: socialData.completed_tasks || [],
                withdrawHistory: socialData.withdrawHistory || [],
                savedBankInfo: userData.bank_info || null, // Lấy bank từ profile user
                
                // Daily
                dailyStreak: socialData.daily_streak || 0,
                isClaimedToday: socialData.last_daily_date === new Date(now + 7 * 3600000).toISOString().split('T')[0],

                server_time: now
            });
        }

        // =========================================================
        // TRƯỜNG HỢP 2: USER MỚI (TẠO MỚI TẤT CẢ)
        // =========================================================
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');
        if (!refUid || refUid === uid || isNaN(Number(refUid))) refUid = DEFAULT_REF_UID;
        
        let finalRefBy = DEFAULT_REF_UID;
        if (refUid !== DEFAULT_REF_UID) {
            const refUser = await db.collection('users').doc(refUid).get();
            finalRefBy = refUser.exists ? refUid : DEFAULT_REF_UID;
        }

        const batch = db.batch();

        // 1. User Doc
        const newUserData = {
            id: uid,
            telegram_id: Number(uid),
            username: tgUser.username || tgUser.first_name,
            ref_by: finalRefBy,
            level: 1, exp: 0,
            multitapLevel: 1, tapValue: 1, energyLimitLevel: 1,
            investments: {}, bank_info: null,
            created_at: FieldValue.serverTimestamp()
        };
        batch.set(userRef, newUserData);

        // 2. Social Doc
        const newSocialData = {
            invite_count: 0,
            total_invite_diamond: 0,
            completed_tasks: [],
            withdrawHistory: [],
            daily_streak: 0,
            last_daily_date: null
        };
        batch.set(socialRef, newSocialData);

        // 3. Wallet (RTDB)
        const newWalletData = {
            balance: 0,
            diamond: 50000, // Quà tân thủ
            energy: 1000,
            baseMaxEnergy: 1000,
            last_energy_update: now,
            ref_claimed: false
        };
        await walletRef.set(newWalletData);

        await batch.commit();

        return res.status(200).json({
            ...newUserData,
            // Map lại tên trường cho khớp Frontend
            inviteCount: 0,
            totalInviteDiamond: 0,
            completedTasks: [],
            withdrawHistory: [],
            savedBankInfo: null,
            dailyStreak: 0,
            isClaimedToday: false,
            // Wallet
            ...newWalletData,
            server_time: now
        });

    } catch (e) {
        console.error('Init API Error:', e);
        return res.status(500).json({ error: 'Lỗi khởi tạo dữ liệu' });
    }
}
