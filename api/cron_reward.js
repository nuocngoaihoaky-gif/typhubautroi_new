import { db, rtdb } from './_lib'; // db = Firestore, rtdb = Realtime DB

// ================= CẤU HÌNH =================
const REWARDS = [150000, 100000, 50000]; // Vàng: Top 1, 2, 3
const TITLES = ["Top 1 BXH", "Top 2 BXH", "Top 3 BXH"];
const RANK_IMAGES = [
    "https://i.imgur.com/zuh0eTS.png", // Top 1
    "https://i.imgur.com/j1MXTdk.png", // Top 2
    "https://i.imgur.com/Rzf9PRO.png"  // Top 3
];

// Cấu hình Giftcode Top 1
const TOP1_GIFTCODE = {
    reward: 500,   // 500 Kim Cương
    usage: 5,      // 5 lượt nhập
    hours: 24      // Hết hạn sau 24h
};

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

// Helper: Sinh mã Giftcode 12 ký tự (A-Z, 0-9), KHÔNG ký tự đặc biệt
const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    // Prefix "TOP1" (4 ký tự) + 8 ký tự ngẫu nhiên = 12 ký tự
    // Hoặc random full 12 ký tự. Ở đây mình làm random full 12 cho khó đoán hẳn.
    // Nếu thích có chữ TOP1 thì sửa vòng lặp i < 8 và result = 'TOP1' + ...
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result; // Ví dụ: A1B2C3D4E5F6
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
        
        // Check đã trả chưa
        const statusSnap = await lbRef.child('is_rewarded').once('value');
        if (statusSnap.val() === true) return res.status(200).json({ message: 'Đã trả rồi!' });

        // 3. Lấy Top 3 từ Realtime DB
        const snapshot = await lbRef.orderByChild('score').limitToLast(3).once('value');
        if (!snapshot.exists()) return res.status(200).json({ message: 'Không có dữ liệu' });

        const winners = [];
        snapshot.forEach((child) => {
            if (child.key === 'is_rewarded') return;
            winners.push({ id: child.key, ...child.val() });
        });
        winners.reverse(); 

        // =========================================================
        // 🔥 XỬ LÝ SONG SONG
        // =========================================================
        const tasks = []; 
        let giftcodeInfo = null;

        // --- A. DUYỆT NGƯỜI CHIẾN THẮNG ---
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

            // 2. Set Admin Telegram
            if (CHAT_ID) {
                // Set Admin (Quyền ảo)
                tasks.push(callTelegram('promoteChatMember', {
                    chat_id: CHAT_ID, user_id: uid, is_anonymous: false,
                    can_manage_chat: false, can_post_messages: false, can_edit_messages: false,
                    can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
                    can_promote_members: false, can_change_info: false, can_invite_users: false, can_pin_messages: false
                }));
                // Set Title
                tasks.push(callTelegram('setChatAdministratorCustomTitle', {
                    chat_id: CHAT_ID, user_id: uid, custom_title: title
                }));
            }

            // 3. Soạn tin nhắn
            let msg = `<b>🎉 CHÚC MỪNG CHIẾN THẮNG 🎉</b>\n\n` +
                      `Bạn đạt <b>TOP ${rank}</b> ngày <b>${displayDate}</b>!\n` +
                      `💰 Thưởng: <b>+${fmt(rewardGold)}💰</b>\n` +
                      `🏆 Danh hiệu: <b>${title}</b>\n`;

            // 🔥 TOP 1: TẠO GIFTCODE (LƯU VÀO FIRESTORE)
            if (index === 0) {
                const code = generateCode(); // 12 ký tự, ko đặc biệt
                const expireTime = Date.now() + (TOP1_GIFTCODE.hours * 60 * 60 * 1000);
                
                // 🔥 Lưu vào Firestore (db) chứ không phải rtdb
                const pCode = db.collection('giftcodes').doc(code).set({
                    reward: TOP1_GIFTCODE.reward, // 500 Kim cương
                    type: 'diamond',
                    usages: TOP1_GIFTCODE.usage,  // 5 lượt
                    expires_at: expireTime,
                    created_at: Date.now(),
                    created_for: uid,
                    desc: `Quà Top 1 ngày ${displayDate}`
                });
                tasks.push(pCode);

                giftcodeInfo = code; // Để báo cáo Admin

                msg += `\n<b>🎁 QUÀ ĐỘC QUYỀN TOP 1:</b>\n` +
                       `Code: <code>${code}</code>\n` +
                       `(500💎 x 5 lượt - HSD 24h)\n` +
                       `<i>👉 Share code này vào nhóm chat để  vui nhé!</i>`;
            }

            msg += `\n<i>Tiền đã về ví. Giữ vững phong độ nhé! ✈️</i>`;

            // 4. Gửi ảnh (Tin nhắn riêng)
            tasks.push(callTelegram('sendPhoto', {
                chat_id: uid,
                photo: RANK_IMAGES[index],
                caption: msg,
                parse_mode: 'HTML'
            }));
        });

        // --- B. XÓA ADMIN CŨ (Realtime DB) ---
        if (CHAT_ID) {
            const oldAdminsSnap = await rtdb.ref('system/current_top_admins').once('value');
            const oldAdmins = oldAdminsSnap.val() || [];
            
            oldAdmins.forEach(uid => {
                // Nếu người cũ ko nằm trong Top 3 mới -> Demote
                if (!winners.find(w => w.id === uid)) {
                    tasks.push(callTelegram('promoteChatMember', {
                        chat_id: CHAT_ID, user_id: uid,
                        can_manage_chat: false, can_post_messages: false, can_edit_messages: false,
                        can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
                        can_promote_members: false, can_change_info: false, can_invite_users: false, can_pin_messages: false
                    })); 
                }
            });

            // Lưu danh sách Admin mới vào Realtime DB
            const newAdminIds = winners.map(w => w.id);
            tasks.push(rtdb.ref('system/current_top_admins').set(newAdminIds));
        }

        // --- C. THỰC THI TẤT CẢ ---
        await Promise.all(tasks);

        // Đánh dấu đã trả thưởng (Realtime DB)
        await lbRef.update({ is_rewarded: true });

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

        return res.status(200).json({ success: true, tasks: tasks.length });

    } catch (e) {
        console.error("Cron Error:", e);
        if (ADMIN_ID) callTelegram('sendMessage', { chat_id: ADMIN_ID, text: `❌ CRON ERROR: ${e.message}` });
        return res.status(500).json({ error: e.message });
    }
}
