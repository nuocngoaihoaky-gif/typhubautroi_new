import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

// ================= FIREBASE INIT =================
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
    } catch (e) {
        console.error('Firebase Init Error:', e);
    }
}
const db = getFirestore();

// ================= CẤU HÌNH PHẦN THƯỞNG =================
const DAILY_REWARDS = [
    5000, 5000, 5000, 5000, 
    10000, // Ngày 5 (Index 4) - CÓ QC
    5000, 5000, 
    10000, // Ngày 8 (Index 7) - CÓ QC
    5000, 
    30000  // Ngày 10 (Index 9) - CÓ QC
];

const AD_REQUIRED_INDICES = [4, 7, 9];

// 🔥 KHAI BÁO MÃ BÍ MẬT (Để tránh lỗi is not defined)
const SECRET_PREFIX = '26032007';

function getVNDateString(timestamp) {
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

// 🔔 HÀM GỬI THÔNG BÁO (Đã sửa lỗi tên biến)
async function sendTelegramNotify(botToken, chatId, newUserName) {
    try {
        // Sử dụng đúng biến newUserName được truyền vào
        const text = `🎉 *BẠN ĐÃ TUYỂN ĐƯỢC PHI CÔNG MỚI!*

👤 *Thành viên:* ${newUserName || 'Một phi công mới'}
✈️ Họ đã gia nhập đội bay của bạn.

💰 Đã nhận: 100,000 xu

👉 Nhấn nút bên dưới để vào Mini App và theo dõi đội bay của bạn 🚀`;

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🚀 Mở Mini App', url: 'https://t.me/TyPhuBauTroi_bot/MiniApp' }
                    ]]
                }
            })
        });
        
        // Log kết quả để debug nếu cần
        const data = await res.json();
        if (!data.ok) console.error("Telegram Error:", data.description);

    } catch (e) {
        console.error('Send Notify Error:', e);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);
    const socialRef = db.collection('user_social').doc(uid);

    try {
        // 🔥 Transaction trả về object result chứa thông tin cần thiết
        const result = await db.runTransaction(async (t) => {
            const socialSnap = await t.get(socialRef);
            const socialData = socialSnap.exists ? socialSnap.data() : {};

            const now = Date.now();
            const todayStr = getVNDateString(now);
            
            if (socialData.last_daily_date === todayStr) {
                throw new Error('Hôm nay bạn đã điểm danh rồi!');
            }

            // Logic Streak
            const lastClaimDateStr = socialData.last_daily_date || '';
            let currentStreak = socialData.daily_streak || 0;
            const yesterdayTimestamp = now - 24 * 3600 * 1000; 
            const yesterdayStr = getVNDateString(yesterdayTimestamp);

            if (lastClaimDateStr === yesterdayStr) currentStreak += 1;
            else currentStreak = 1;
            
            if (currentStreak > DAILY_REWARDS.length) currentStreak = 1;

            const currentIdx = currentStreak - 1;

            // Check QC
            if (AD_REQUIRED_INDICES.includes(currentIdx)) {
                return { status: 'require_ad' }; 
            }

            // =========================================================
            // 🎁 XỬ LÝ REF (LOGIC MỚI: CHECK TIỀN TỐ BÍ MẬT)
            // =========================================================
            let notifyInfo = null; // Biến lưu thông tin để gửi tin nhắn sau
            let realInviterId = null; // ID thật sau khi đã xử lý xong
            const invitedFriendData = {
                uid: uid,
                username: tgUser.username || tgUser.first_name || `Phi công ${uid.slice(-4)}`,
                joined_at: now,
                reward: 100000,
                type: `ID: ${uid}`
            };
            const currentRefBy = socialData.ref_by;

            // Kiểm tra: Có ref_by VÀ bắt đầu bằng mã bí mật
            if (currentRefBy && typeof currentRefBy === 'string' && currentRefBy.startsWith(SECRET_PREFIX)) {
                
                // 1. Cắt mã bí mật đi để lấy ID thật (Ví dụ: "2603200712345" -> "12345")
                const rawId = currentRefBy.slice(SECRET_PREFIX.length);
                
                // Đảm bảo ID không rỗng
                if (rawId) {
                    const inviterUserRef = db.collection('users').doc(rawId);
                    const inviterSocialRef = db.collection('user_social').doc(rawId);

                    // Đọc data người mời để chắc chắn họ tồn tại
                    const inviterSnap = await t.get(inviterUserRef);
                    
                    if (inviterSnap.exists) {
                        // 2. Cộng thưởng người mời
                        t.update(inviterUserRef, {
                             balance: FieldValue.increment(100000)
                        });

                        t.set(inviterSocialRef, {
                            invite_count: FieldValue.increment(1),
                            friends: FieldValue.arrayUnion(invitedFriendData)
                        }, { merge: true });

                        // 3. Lưu lại thông tin để tý nữa gửi tin nhắn
                        notifyInfo = {
                            inviterId: rawId,
                            newUserName: tgUser.first_name || tgUser.username
                        };

                        // 4. Đánh dấu là tìm thấy ID thật
                        realInviterId = rawId;
                    }

                }
            }

            // =========================================================
            // ✅ CẬP NHẬT USER HIỆN TẠI
            // =========================================================
            const reward = DAILY_REWARDS[currentIdx];

            t.update(userRef, { balance: FieldValue.increment(reward) });

            const updateData = {
                daily_streak: currentStreak,
                last_daily_date: todayStr,
                // 🔥 QUAN TRỌNG: Update lại ref_by thành ID thật (bỏ mã 26032007)
                // Để lần sau vào check thì không cộng tiền lại nữa
                ...(realInviterId && { ref_by: realInviterId })
            };

            if (!socialSnap.exists) {
                t.set(socialRef, { 
                    ...updateData, 
                    ref_by: realInviterId || '8065435277',
                    invite_count: 0, 
                    completed_tasks: [],
                    friends: []
                }, { merge: true });
            } else {
                t.update(socialRef, updateData);
            }

            // Trả về kết quả kèm thông tin gửi tin nhắn
            return { 
                status: 'success', 
                reward, 
                notifyInfo 
            };
        });

        // =========================================================
        // 📨 GỬI TIN NHẮN (SAU KHI TRANSACTION THÀNH CÔNG)
        // =========================================================
        if (result.status === 'success' && result.notifyInfo) {
            // ⚠️ QUAN TRỌNG: Phải có await, bắt buộc try-catch để không lỗi luồng chính
            try {
                await sendTelegramNotify(botToken, result.notifyInfo.inviterId, result.notifyInfo.newUserName);
            } catch (err) {
                console.error("Lỗi gửi tin nhắn:", err);
            }
        }

        // ================= TRẢ RESPONSE =================
        if (result.status === 'require_ad') {
            return res.status(200).json({ ok: true, status: 'require_ad', message: 'Yêu cầu xem quảng cáo' });
        }

        return res.status(200).json({ ok: true, status: 'success', reward: result.reward, message: 'Điểm danh thành công' });

    } catch (e) {
        console.error("Check-in API Error:", e);
        return res.status(400).json({ error: e.message });
    }
}
