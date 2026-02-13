import { db, rtdb } from './_lib'; // db = Firestore, rtdb = Realtime DB

// ================= CẤU HÌNH =================
const REWARDS = [0, 0, 0]; // Vàng: Top 1, 2, 3
const TITLES = ["Top 1 BXH", "Top 2 BXH", "Top 3 BXH"];

// 🔥 DÙNG FILE_ID THAY CHO LINK ẢNH (Load siêu nhanh, không lỗi)
const RANK_IMAGES = [
    "AgACAgUAAxkBAAFCXtxpj3t0NYtt5HwMySrcgdKf-wg5aAACmg1rG_vRgVR0B6jeMM-jwwEAAwIAA20AAzoE", // Top 1
    "AgACAgUAAxkBAAFCXuxpj33jQ1AZjzYrbtGEJJOPhKgj2QACmw1rG_vRgVT07GL2aJ6cUgEAAwIAA3kAAzoE", // Top 2
    "AgACAgUAAxkBAAFCXvJpj34IN9_CMf6bvBuevUeCVkzmHwACnA1rG_vRgVQKAAFA7AyrJtgBAAMCAAN5AAM6BA"  // Top 3
];

// Cấu hình Giftcode Top 1
const TOP1_GIFTCODE = {
    amount: 500,       // 500 Kim cương
    type: 'diamond',   // Loại tiền
    limit: 5,          // 5 lượt nhập
    days: 1            // Hết hạn sau 1 ngày
};

// 🔥 ID Cứng
const CHAT_ID = '-1003866604957'; 
const ADMIN_ID = '8065435277'; 
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Helper: Gọi Telegram (Fire-and-forget)
const callTelegram = (method, body) => {
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(err => console.error(`Tele API Error (${method}):`, err.message));
};

// Helper: Sinh mã Giftcode 12 ký tự (A-Z, 0-9)
const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result; 
};

const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

export default async function handler(req, res) {
    // 1. Bảo mật
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // 2. Xác định ngày hôm qua (Giờ VN)
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
        now.setDate(now.getDate() - 1); 
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const displayDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        // 🔥 BXH nằm ở Realtime DB
        const lbRef = rtdb.ref(`daily_leaderboard/${dateKey}`);
        
        // 3. Lấy Top 3 từ Realtime DB
        const snapshot = await lbRef.orderByChild('score').limitToLast(3).once('value');
        
        // Nếu không có dữ liệu (hoặc đã bị xóa do chạy rồi) -> Dừng
        if (!snapshot.exists()) {
            return res.status(200).json({ message: 'Không có dữ liệu hoặc đã trả thưởng xong.' });
        }

        const winners = [];
        snapshot.forEach((child) => {
            if (child.key === 'is_rewarded') return; // Bỏ qua node flag cũ nếu còn sót
            winners.push({ id: child.key, ...child.val() });
        });
        winners.reverse(); // Đảo ngược để Top 1 lên đầu

        // =========================================================
        // 🔥 XỬ LÝ SONG SONG (Tốc độ cao)
        // =========================================================
        const tasks = []; 
        let giftcodeInfo = null;

        // --- A. TRẢ THƯỞNG & GỬI TIN NHẮN ---
        winners.forEach((user, index) => {
            const uid = user.id;
            const rewardGold = REWARDS[index];
            const title = TITLES[index];
            const rank = index + 1;

            if (!rewardGold) return;

            // 1. Cộng Vàng vào ví (Realtime DB)
            const pWallet = rtdb.ref(`user_wallets/${uid}`).transaction((wallet) => {
                if (wallet) wallet.balance = (Number(wallet.balance) || 0) + rewardGold;
                return wallet;
            });
            tasks.push(pWallet);

            // 2. Set Admin & Title Group
            if (CHAT_ID) {
                // Promote (Admin ảo - Không quyền)
                tasks.push(callTelegram('promoteChatMember', {
                    chat_id: CHAT_ID, user_id: uid, is_anonymous: false,
                    can_manage_chat: false, can_post_messages: false, can_edit_messages: false,
                    can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
                    can_promote_members: false, can_change_info: false, can_invite_users: false, can_pin_messages: false
                }));
                // Set Title (Danh hiệu)
                tasks.push(callTelegram('setChatAdministratorCustomTitle', {
                    chat_id: CHAT_ID, user_id: uid, custom_title: title
                }));
            }

            // 3. Soạn nội dung tin nhắn riêng
            let msg = `<b>🎉 CHÚC MỪNG CHIẾN THẮNG 🎉</b>\n\n` +
                      `Bạn đạt <b>TOP ${rank}</b> ngày <b>${displayDate}</b>!\n` +
                      `💰 Thưởng: <b>+${fmt(rewardGold)} Vàng</b>\n` +
                      `🏆 Danh hiệu: <b>${title}</b>\n`;

            // 🔥 QUÀ ĐẶC BIỆT CHO TOP 1: GIFTCODE (FIRESTORE)
            if (index === 0) {
                const code = generateCode();
                
                // Tính hạn sử dụng (ms timestamp)
                const expiryDate = Date.now() + (TOP1_GIFTCODE.hours * 60 * 60 * 1000);
                
                // 🔥 DATA CHUẨN (Khớp với api/giftcode.js)
                const giftData = {
                    rewardAmount: TOP1_GIFTCODE.amount,
                    rewardType: TOP1_GIFTCODE.type,
                    usageLimit: TOP1_GIFTCODE.limit,
                    usageCount: 0,
                    expiryDate: expiryDate,
                    usedBy: [],
                    createdAt: Date.now(),
                    note: `Quà Top 1 ngày ${displayDate} cho ${user.name}`
                };

                // Lưu vào Firestore
                tasks.push(db.collection('giftcodes').doc(code).set(giftData));

                giftcodeInfo = code; // Lưu mã để tí báo cáo Admin

                msg += `\n<b>🎁 QUÀ ĐỘC QUYỀN TOP 1:</b>\n` +
                       `Code: <code>${code}</code>\n` +
                       `(${fmt(TOP1_GIFTCODE.amount)}💎 x ${TOP1_GIFTCODE.limit} lượt)\n` +
                       `<i>👉 Share code này vào nhóm để chia vui nhé!</i>`;
            }

            msg += `\n<i>Tiền đã về ví. Giữ vững phong độ nhé! ✈️</i>`;

            // 4. Gửi ảnh vinh danh bằng FILE_ID
            tasks.push(callTelegram('sendPhoto', {
                chat_id: uid,
                photo: RANK_IMAGES[index], // Sử dụng file_id
                caption: msg,
                parse_mode: 'HTML'
            }));
        });

        // --- B. DỌN DẸP ADMIN CŨ (Realtime DB) ---
        if (CHAT_ID) {
            const oldAdminsSnap = await rtdb.ref('system/current_top_admins').once('value');
            const oldAdmins = oldAdminsSnap.val() || [];
            
            oldAdmins.forEach(uid => {
                // Nếu người cũ KHÔNG nằm trong Top 3 mới -> Xóa quyền (Demote)
                if (!winners.find(w => w.id === uid)) {
                    tasks.push(callTelegram('promoteChatMember', {
                        chat_id: CHAT_ID, user_id: uid,
                        can_manage_chat: false, can_post_messages: false, can_edit_messages: false,
                        can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
                        can_promote_members: false, can_change_info: false, can_invite_users: false, can_pin_messages: false
                    })); 
                }
            });

            // Cập nhật danh sách Admin mới
            const newAdminIds = winners.map(w => w.id);
            tasks.push(rtdb.ref('system/current_top_admins').set(newAdminIds));
        }

        // --- C. CHẠY TẤT CẢ (Promise.all) ---
        await Promise.all(tasks);

        // =========================================================
        // 🔥 QUAN TRỌNG: XÓA NODE NGÀY CŨ ĐỂ KHÔNG PHÌNH DATA
        // =========================================================
        // Lệnh này sẽ xóa toàn bộ nhánh daily_leaderboard/202X-XX-XX
        await lbRef.remove();

        // --- D. BÁO CÁO ADMIN ---
        if (ADMIN_ID) {
            let report = `<b>✅ TRẢ THƯỞNG ${displayDate} DONE</b>\n\n`;
            winners.forEach((w, i) => {
                report += `${["🥇","🥈","🥉"][i]} <b>${w.name}</b>: +${fmt(REWARDS[i])} Gold\n`;
            });
            
            if (giftcodeInfo) {
                report += `\n🎟 <b>Code Top 1:</b> <code>${giftcodeInfo}</code>`;
            }

            callTelegram('sendMessage', {
                chat_id: ADMIN_ID,
                text: report,
                parse_mode: 'HTML'
            });
        }

        return res.status(200).json({ success: true, count: tasks.length });

    } catch (e) {
        console.error("Cron Error:", e);
        if (ADMIN_ID) callTelegram('sendMessage', { chat_id: ADMIN_ID, text: `❌ CRON ERROR: ${e.message}` });
        return res.status(500).json({ error: e.message });
    }
}
