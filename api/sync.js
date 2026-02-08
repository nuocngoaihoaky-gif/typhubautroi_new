import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_REF_UID = '8065435277'; // ID Admin
const REGEN_RATE = 3;                 // Tốc độ hồi năng lượng

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Auth
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        const now = Date.now();

        // 🔥 GỌI SONG SONG 2 DB (Tốn đúng 1 Read Firestore)
        const [userSnap, walletSnap] = await Promise.all([
            userRef.get(),
            walletRef.once('value')
        ]);

        let userData = userSnap.exists ? userSnap.data() : null;
        let walletData = walletSnap.val();

        // =========================================================
        // TRƯỜNG HỢP 1: USER CŨ (Đã có data)
        // =========================================================
        if (userData) {
            // Tự fix nếu thiếu Ví (Migration cho user cũ)
            if (!walletData) {
                walletData = { 
                    balance: userData.balance || 0, // Cứu số dư cũ nếu có
                    diamond: 0, 
                    energy: 1000, 
                    baseMaxEnergy: 1000, 
                    last_energy_update: now,
                    ref_claimed: false 
                };
                await walletRef.set(walletData);
            }

            // Tính toán hồi năng lượng
            const lastUpdate = walletData.last_energy_update || now;
            const maxEnergy = walletData.baseMaxEnergy || 1000;
            let currentEnergy = walletData.energy || 0;
            const elapsed = Math.floor((now - lastUpdate) / 1000);
            
            if (elapsed > 0 && currentEnergy < maxEnergy) {
                currentEnergy = Math.min(currentEnergy + elapsed * REGEN_RATE, maxEnergy);
            }

            // Trả về Full Data (Gộp User + Social + Wallet)
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
                refClaimed: walletData.ref_claimed || false, // Cờ check ref
                
                // Upgrades
                tapValue: userData.tapValue || 1,
                multitapLevel: userData.multitapLevel || 1,
                energyLimitLevel: userData.energyLimitLevel || 1,
                investments: userData.investments || {},
                
                // Social & History (Lấy từ UserData đã gộp)
                inviteCount: userData.invite_count || 0,
                totalInviteDiamond: userData.total_invite_diamond || 0,
                completedTasks: userData.completed_tasks || [],
                withdrawHistory: userData.withdrawHistory || [],
                savedBankInfo: userData.bank_info || null,
                
                // Daily Checkin
                dailyStreak: userData.daily_streak || 0,
                isClaimedToday: userData.last_daily_date === new Date(now + 7 * 3600000).toISOString().split('T')[0],

                server_time: now
            });
        }

        // =========================================================
        // TRƯỜNG HỢP 2: USER MỚI (TẠO MỚI)
        // =========================================================
        const params = new URLSearchParams(initData);
        let refUid = params.get('start_param');
        
        // Validate Ref ID
        if (!refUid || refUid === uid || isNaN(Number(refUid))) {
            refUid = DEFAULT_REF_UID;
        }
        
        let finalRefBy = DEFAULT_REF_UID;
        
        // Check người mời có tồn tại không (Tốn 1 Read - Chấp nhận được vì chỉ 1 lần/đời user)
        if (refUid !== DEFAULT_REF_UID) {
            const refUser = await db.collection('users').doc(refUid).get();
            finalRefBy = refUser.exists ? refUid : DEFAULT_REF_UID;
        }

        const batch = db.batch();

        // 1. Tạo Document User (Gộp cả Profile + Social + Bank vào đây)
        const newUserData = {
            id: uid,
            telegram_id: Number(uid),
            username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
            
            // Ref Info (Lưu UID sạch)
            ref_by: finalRefBy,
            
            // Game Stats
            level: 1, 
            exp: 0,
            multitapLevel: 1, 
            tapValue: 1, 
            energyLimitLevel: 1,
            investments: {}, 
            bank_info: null,
            
            // Social Fields (GỘP LUÔN VÀO ĐÂY)
            invite_count: 0,
            total_invite_diamond: 0,
            completed_tasks: [],
            withdrawHistory: [],
            daily_streak: 0,
            last_daily_date: null,

            created_at: FieldValue.serverTimestamp()
        };
        batch.set(userRef, newUserData);

        // 2. Tạo Ví (Realtime DB) - 🔥 QUÀ TÂN THỦ
        const newWalletData = {
            balance: 0,          // Vàng
            diamond: 50000,      // Kim cương tân thủ
            energy: 1000,
            baseMaxEnergy: 1000,
            last_energy_update: now,
            
            // Cờ đánh dấu chưa nhận thưởng ref (khi nào bay chuyến đầu thì set true)
            ref_claimed: false 
        };
        await walletRef.set(newWalletData); 

        // Chốt đơn Firestore
        await batch.commit();

        return res.status(200).json({
            // Trả về data vừa tạo
            ...newUserData,
            // Map lại tên field cho khớp Frontend (camelCase) nếu cần thiết, 
            // hoặc Frontend tự lấy đúng key (invite_count -> inviteCount)
            // Ở đây map thủ công cho an toàn với code cũ:
            inviteCount: 0,
            totalInviteDiamond: 0,
            completedTasks: [],
            withdrawHistory: [],
            savedBankInfo: null,
            dailyStreak: 0,
            isClaimedToday: false,
            
            // Wallet info
            ...newWalletData,
            
            server_time: now
        });

    } catch (e) {
        console.error('Init API Error:', e);
        return res.status(500).json({ error: 'Lỗi khởi tạo dữ liệu' });
    }
}
