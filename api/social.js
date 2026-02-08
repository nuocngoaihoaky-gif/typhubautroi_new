import { db, verifyInitData } from './_lib';

// Helper: Lấy ngày giờ Việt Nam (YYYY-MM-DD)
function getVNDateString(timestamp) {
    if (!timestamp) return '';
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // 1. VERIFY (Dùng hàm từ _lib.js)
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);

    try {
        // 2. LẤY DỮ LIỆU TỪ FIRESTORE (1 Read)
        const socialRef = db.collection('user_social').doc(uid);
        const socialSnap = await socialRef.get();
        const socialData = socialSnap.exists ? socialSnap.data() : {};

        // 3. XỬ LÝ ĐIỂM DANH (DAILY)
        const now = Date.now();
        const todayStr = getVNDateString(now);
        const yesterdayStr = getVNDateString(now - 24 * 3600 * 1000);
        
        let currentStreak = socialData.daily_streak || 0;
        const lastClaimDate = socialData.last_daily_date || '';
        const isClaimedToday = lastClaimDate === todayStr;

        // Reset chuỗi nếu quên điểm danh hôm qua
        if (lastClaimDate !== todayStr && lastClaimDate !== yesterdayStr) {
            currentStreak = 0;
        }

        // 4. TRẢ VỀ DỮ LIỆU
        return res.status(200).json({
            // Nhiệm vụ
            completedTasks: socialData.completed_tasks || [],
            
            // Bạn bè
            friends: [], // Vẫn để rỗng để tiết kiệm data
            inviteCount: socialData.invite_count || 0,
            
            // 🔥 THÊM CÁI NÀY: Tổng Kim Cương kiếm được từ mời
            totalInviteDiamond: socialData.total_invite_diamond || 0, 
            
            // Điểm danh
            dailyStreak: currentStreak,
            isClaimedToday: isClaimedToday,
            lastDailyClaim: socialData.last_daily_date || '',

            // Lịch sử rút tiền
            history: socialData.withdrawHistory || []
        });

    } catch (e) {
        console.error('Social API Error:', e);
        return res.status(500).json({ error: 'Lỗi tải dữ liệu xã hội' });
    }
}
