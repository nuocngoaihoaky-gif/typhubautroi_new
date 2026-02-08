import { db, rtdb } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '8065435277'; // ID Admin

// Cấu hình phần thưởng điểm danh (Đã đổi sang KIM CƯƠNG - Tỷ lệ 1/10)
const DAILY_REWARDS = [
    500, 500, 500, 500, 
    1000, // Ngày 5
    500, 500, 
    1000, // Ngày 8
    500, 
    3000  // Ngày 10
];

function getVNDateString(timestamp) {
    const vnTime = new Date(timestamp + 7 * 3600 * 1000);
    return vnTime.toISOString().split('T')[0];
}

// ==================================================================
// 🟢 MAIN HANDLER (CỬA NGÕ XỬ LÝ)
// ==================================================================
export default async function handler(req, res) {
    try {
        // =====================================================
        // 🟢 1. GET REQUEST (CALLBACK TỪ GAME / ADSGRAM)
        // =====================================================
        const { uid, type } = req.query || {};
        
        if (req.method === 'GET' && uid && type) {
            const userRef = db.collection('users').doc(String(uid));
            const socialRef = db.collection('user_social').doc(String(uid));
            const walletRef = rtdb.ref(`user_wallets/${uid}`);
            const now = Date.now();

            // A. ADSGRAM TASK (Xem QC nhận thưởng)
            if (type === 'adsgram-task') {
                // Cộng Vàng vào RTDB (25k Vàng)
                await walletRef.transaction((data) => {
                    if (data) {
                        data.balance = (data.balance || 0) + 25000;
                    }
                    return data;
                });
                // Update thống kê vào Firestore (nếu cần)
                userRef.update({ total_earned: FieldValue.increment(25000) }).catch(() => {});
            } 
            
            // B. ENERGY REWARD (Xem QC hồi năng lượng -> ĐỔI THÀNH CỘNG KIM CƯƠNG)
            else if (type === 'energy') {
                await walletRef.transaction((data) => {
                    if (data) {
                        const maxEnergy = data.baseMaxEnergy || 1000;
                        // Thay vì hồi năng lượng, cộng Kim Cương = Max Energy
                        data.diamond = (data.diamond || 0) + maxEnergy;
                    }
                    return data;
                });
            } 
            
            // C. CHECK-IN (Điểm danh qua Webhook/Link)
            else if (type === 'check-in') {
                let reward = 0;
                
                await db.runTransaction(async (t) => {
                    const socialSnap = await t.get(socialRef);
                    const socialData = socialSnap.exists ? socialSnap.data() : {};
                    const todayStr = getVNDateString(now);

                    if (socialData.last_daily_date === todayStr) return; // Đã điểm danh

                    // Tính Streak
                    let currentStreak = socialData.daily_streak || 0;
                    const yesterdayStr = getVNDateString(now - 86400000);
                    
                    if (socialData.last_daily_date === yesterdayStr) currentStreak++;
                    else currentStreak = 1;
                    
                    if (currentStreak > DAILY_REWARDS.length) currentStreak = 1;

                    // Lấy quà (Kim cương)
                    reward = DAILY_REWARDS[currentStreak - 1] || 500;

                    // Update Firestore (Lưu ngày + streak)
                    const updateData = { daily_streak: currentStreak, last_daily_date: todayStr };
                    if (!socialSnap.exists) {
                        t.set(socialRef, { ...updateData, invite_count: 0, completed_tasks: [] }, { merge: true });
                    } else {
                        t.update(socialRef, updateData);
                    }
                });

                // Nếu tính toán thành công (có quà) -> Cộng vào RTDB
                if (reward > 0) {
                    await walletRef.transaction((data) => {
                        if (data) data.diamond = (data.diamond || 0) + reward;
                        return data;
                    });
                }
            }
            return res.status(200).json({ ok: true });
        }

        // =====================================================
        // 🟢 2. POST REQUEST (WEBHOOK NGÂN HÀNG & TELEGRAM)
        // =====================================================
        if (req.method === 'POST') {
            const body = req.body;
            // Lấy nội dung tin nhắn hoặc nội dung chuyển khoản
            const content = (body.content || body.description || "").toString();

            // A. WEBHOOK NGÂN HÀNG (Ưu tiên)
            // Kiểm tra nội dung CK có chữ "TyPhuBauTroi" (không phân biệt hoa thường)
            if (content && content.toUpperCase().includes('TYPHUBAUTROI')) {
                return await handleBankWebhook(content, res);
            }

            // B. TELEGRAM MESSAGE (Chat, Start, Menu)
            if (body.message) {
                return await handleTelegramMessage(body, res);
            }

            return res.status(200).json({ status: 'ignored' });
        }

        return res.status(405).send('Method Not Allowed');

    } catch (e) {
        console.error('Handler Error:', e);
        return res.status(200).json({ error: e.message });
    }
}

// =====================================================
// 🛠️ HÀM XỬ LÝ WEBHOOK NGÂN HÀNG (AUTO DUYỆT)
// =====================================================
async function handleBankWebhook(content, res) {
    try {
        console.log("🔔 Bank Webhook:", content);

        // 1. Parse ID Đơn + UID
        // Regex: Tìm chuỗi số + TyPhuBauTroi + chuỗi số
        const match = content.match(/(\d+)\s*TyPhuBauTroi\s*(\d+)/i);
        if (!match) {
            return res.status(200).json({ status: 'ignored_no_match' });
        }

        const transCode = match[1]; // Mã giao dịch (ID tin nhắn Admin)
        const uid = match[2];       // UID user

        // 2. Tìm User trong Firestore
        const socialRef = db.collection('user_social').doc(String(uid));
        const snap = await socialRef.get();

        if (!snap.exists) {
            return res.status(200).json({ status: 'user_not_found' });
        }

        const socialData = snap.data();
        const history = socialData.withdrawHistory || [];

        // 3. Tìm đơn hàng trùng khớp
        const idx = history.findIndex(
            item => String(item.id) === String(transCode)
        );

        if (idx === -1) {
            return res.status(200).json({ status: 'order_not_found' });
        }

        const transaction = history[idx];

        // 4. Check trạng thái (Tránh duyệt lại đơn đã xong)
        if (transaction.status === 'done') {
            return res.status(200).json({ status: 'already_done' });
        }

        // 5. Update trạng thái thành công (Done)
        history[idx] = {
            ...transaction,
            status: 'done',
            updated_at: Date.now()
        };

        await socialRef.update({
            withdrawHistory: history
        });

        // 6. Xử lý Telegram: Xóa tin nhắn Admin & Báo User
        await deleteTelegramMsg(transCode);
        await sendUserSuccessMsg(uid, transaction.amount, transaction.method);

        return res.status(200).json({ success: true });

    } catch (e) {
        console.error("Bank Error:", e);
        return res.status(200).json({ error: e.message });
    }
}


// =====================================================
// 🛠️ HÀM XỬ LÝ TELEGRAM MESSAGE (BOT)
// =====================================================
async function handleTelegramMessage(update, res) {
    if (update.message && update.message.text) {
        const text = update.message.text.trim();
        const chatId = update.message.chat.id;

        // Xử lý /start
        if (text === '/start') {
            const BROADCAST_MSG = `⛏️ TỶ PHÚ BẦU TRỜI - GIẢI TRÍ KIẾM TIỀN 2026

Biến thời gian rảnh rỗi thành thu nhập thật! Không cần nạp vốn, không rủi ro.

Cơ chế kiếm tiền đơn giản:
✈️ Bay máy bay: Dùng năng lượng miễn phí để thu thập Xu trên bầu trời.
💰 Tích lũy: Gom Xu càng nhiều, đổi thưởng càng lớn.
🎁 Nhiệm vụ: Làm task nhẹ nhàng (Join group, mời bạn) nhận thưởng nóng.
💎 Mời bạn bè: Nhận Kim Cương cực khủng.
🏦 Rút tiền: Hỗ trợ quy đổi Xu về tài khoản ngân hàng nhanh chóng.

👉 Ấn nút Mở Mini App 🚀 để bắt đầu ngay!`;

            // Menu chính (Reply Keyboard)
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '👋 Chào mừng bạn đến với Tỷ Phú Bầu Trời!',
                    reply_markup: {
                        keyboard: [
                            [{ text: 'Mở Mini App 🚀', web_app: { url: 'https://typhubautroi.vercel.app/' } }],
                            [{ text: '📢 Tỷ Phú Bầu Trời Channel' }],
                            [{ text: '👥 Group chat Tỷ Phú Bầu Trời' }]
                        ],
                        resize_keyboard: true
                    }
                })
            });

            // Tin nhắn giới thiệu (Inline Keyboard)
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: BROADCAST_MSG,
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '🚀 Mở Mini App',
                                url: 'https://t.me/TyPhuBauTroi_bot/MiniApp'
                            }
                        ]]
                    }
                })
            });

            return res.status(200).json({ ok: true });
        }

        // Xử lý nút Menu
        if (text === '📢 Tỷ Phú Bầu Trời Channel') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '📢 Truy cập kênh chính thức tại đây:',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '👉 BẤM ĐỂ THAM GIA KÊNH', url: 'https://t.me/vienduatin' }
                        ]]
                    }
                })
            });
            return res.status(200).json({ ok: true });
        }

        if (text === '👥 Group chat Tỷ Phú Bầu Trời') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '👥 Tham gia cộng đồng thảo luận tại đây:',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '👉 BẤM ĐỂ VÀO NHÓM', url: 'https://t.me/BAOAPPMIENPHI22' }
                        ]]
                    }
                })
            });
            return res.status(200).json({ ok: true });
        }
    }
    return res.status(200).json({ ok: true });
}

// ==================== HELPERS ====================

// Xóa tin nhắn Admin (Khi đơn đã duyệt)
async function deleteTelegramMsg(msgId) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, message_id: msgId })
        });
    } catch (e) { console.error("Del Msg Error:", e); }
}

// Báo User đơn thành công
async function sendUserSuccessMsg(uid, amount, bankInfo) {
    try {
        const text = `🎉 *ĐƠN RÚT ĐÃ ĐƯỢC THANH TOÁN!*

💰 *Số tiền:* ${Number(amount).toLocaleString()} VND
🏦 *Hình thức:* ${bankInfo}

Cảm ơn bạn đã sử dụng hệ thống ✈️`;

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: uid,
                text,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🚀 Mở Mini App', url: 'https://t.me/TyPhuBauTroi_bot/MiniApp' }
                    ]]
                }
            })
        });
    } catch (e) { console.error("Send Msg Error:", e); }
}
