import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// 1. KHỞI TẠO FIREBASE
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const db = getFirestore();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = '8065435277'; // ID Admin để xóa tin nhắn

// Cấu hình phần thưởng điểm danh
const DAILY_REWARDS = [5000, 5000, 5000, 5000, 10000, 5000, 5000, 10000, 5000, 30000];

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
        // 🟢 1. GET REQUEST (LOGIC GAME + ADSGRAM)
        // =====================================================
        const { uid, type } = req.query || {};
        if (req.method === 'GET' && uid && type) {
            const userRef = db.collection('users').doc(String(uid));
            const now = Date.now();

            if (type === 'adsgram-task') {
                await userRef.update({
                    balance: FieldValue.increment(25000),
                    totalEarned: FieldValue.increment(25000)
                });
            } else if (type === 'energy') {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(userRef);
                    if (!doc.exists) return;
                    t.update(userRef, {
                        energy: doc.data().baseMaxEnergy || 1000,
                        next_refill_at: now + 15 * 60 * 1000,
                        last_energy_update: now
                    });
                });
            } else if (type === 'check-in') {
                const socialRef = db.collection('user_social').doc(String(uid));
                await db.runTransaction(async (t) => {
                    const socialSnap = await t.get(socialRef);
                    const socialData = socialSnap.exists ? socialSnap.data() : {};
                    const todayStr = getVNDateString(now);

                    if (socialData.last_daily_date === todayStr) return;

                    let currentStreak = socialData.daily_streak || 0;
                    const yesterdayStr = getVNDateString(now - 86400000);
                    if (socialData.last_daily_date === yesterdayStr) currentStreak++;
                    else currentStreak = 1;
                    if (currentStreak > DAILY_REWARDS.length) currentStreak = 1;

                    const reward = DAILY_REWARDS[currentStreak - 1] || 5000;
                    t.update(userRef, { balance: FieldValue.increment(reward) });

                    const updateData = { daily_streak: currentStreak, last_daily_date: todayStr };
                    if (!socialSnap.exists) {
                        t.set(socialRef, { ...updateData, ref_by: '8065435277', invite_count: 0, completed_tasks: [] }, { merge: true });
                    } else {
                        t.update(socialRef, updateData);
                    }
                });
            }
            return res.status(200).json({ ok: true });
        }

        // =====================================================
        // 🟢 2. POST REQUEST (WEBHOOK & TELEGRAM)
        // =====================================================
        if (req.method === 'POST') {
            const body = req.body;
            const content = (body.content || body.description || "").toString();

            // A. WEBHOOK NGÂN HÀNG (Ưu tiên)
            // Kiểm tra nội dung CK có chữ "TyPhuBauTroi" không
            if (content && content.toUpperCase().includes('TYPHUBAUTROI')) {
                return await handleBankWebhook(content, res);
            }

            // B. TELEGRAM MESSAGE (Chat, Start, Menu)
            if (body.message) {
                return await handleTelegramMessage(body, res);
            }

            // C. TELEGRAM CALLBACK (Nếu có nút bấm sau này)
            if (body.callback_query) {
                return res.status(200).json({ ok: true }); // Tạm thời bỏ qua hoặc xử lý nếu cần
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

        // =================================================
        // 1. PARSE ID ĐƠN + UID
        // Format: <orderId> TyPhuBauTroi <uid>
        // Ví dụ: 468291 TyPhuBauTroi 123456789
        // =================================================
        const match = content.match(/(\d+)\s*TyPhuBauTroi\s*(\d+)/i);
        if (!match) {
            return res.status(200).json({ status: 'ignored_no_match' });
        }

        const transCode = match[1]; // ID đơn / message Telegram
        const uid = match[2];       // UID user

        // =================================================
        // 2. ĐỌC ĐÚNG 1 DOCUMENT USER
        // =================================================
        const socialRef = db.collection('user_social').doc(String(uid));
        const snap = await socialRef.get();

        if (!snap.exists) {
            return res.status(200).json({ status: 'user_not_found' });
        }

        const socialData = snap.data();
        const history = socialData.withdrawHistory || [];

        // =================================================
        // 3. TÌM ĐÚNG ĐƠN TRONG MẢNG
        // =================================================
        const idx = history.findIndex(
            item => String(item.id) === String(transCode)
        );

        if (idx === -1) {
            return res.status(200).json({ status: 'order_not_found' });
        }

        const transaction = history[idx];

        // =================================================
        // 4. CHECK TRẠNG THÁI (GỌI 2 LẦN KHÔNG SAO)
        // =================================================
        if (transaction.status === 'success' || transaction.status === 'done') {
            return res.status(200).json({ status: 'already_done' });
        }

        // =================================================
        // 5. UPDATE TRẠNG THÁI (KHÔNG CỘNG TIỀN)
        // =================================================
        history[idx] = {
            ...transaction,
            status: 'done',
            updated_at: Date.now()
        };

        await socialRef.update({
            withdrawHistory: history
        });

        // =================================================
        // 6. TELEGRAM
        // =================================================
        await deleteTelegramMsg(transCode);
        await sendUserSuccessMsg(uid, transaction.amount, transaction.method);

        return res.status(200).json({ success: true });

    } catch (e) {
        console.error("Bank Error:", e);
        return res.status(200).json({ error: e.message });
    }
}


// =====================================================
// 🛠️ HÀM XỬ LÝ TELEGRAM MESSAGE (LOGIC CŨ CỦA BẠN)
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
🎁 Nhiệm vụ: Làm task nhẹ nhàng (Join group, mời bạn) nhận thưởng nóng
🏦 Rút tiền: Hỗ trợ quy đổi Xu về tài khoản ngân hàng/Momo nhanh chóng.

👉 Ấn nút Mở Mini App 🚀 để bắt đầu ngay!`;

            // 1️⃣ Gửi menu chính (Reply Keyboard - Nút ở đáy)
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

            // 2️⃣ Gửi nội dung giới thiệu + nút Mini App (Inline Keyboard)
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

        // Xử lý nút bấm Menu (Bắt Text)
        // 📢 Channel
        if (text === '📢 Tỷ Phú Bầu Trời Channel') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '📢 Truy cập kênh chính thức tại đây:',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '👉 BẤM ĐỂ THAM GIA KÊNH',
                                url: 'https://t.me/vienduatin'
                            }
                        ]]
                    }
                })
            });
            return res.status(200).json({ ok: true });
        }

        // 👥 Group
        if (text === '👥 Group chat Tỷ Phú Bầu Trời') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '👥 Tham gia cộng đồng thảo luận tại đây:',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '👉 BẤM ĐỂ VÀO NHÓM',
                                url: 'https://t.me/BAOAPPMIENPHI22'
                            }
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

// Tìm User sở hữu đơn rút tiền (Quét toàn bộ collection user_social)
// Vì DB của bạn lưu dạng mảng trong document user_social, không query trực tiếp được
async function findUserByTransId(transCode) {
    const snapshot = await db.collection('user_social').get();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const history = data.withdrawHistory || [];
        // Tìm xem trong lịch sử của user này có mã đơn trùng khớp không
        const found = history.find(item => String(item.id) === String(transCode));
        if (found) {
            return { uid: doc.id, transaction: found, socialData: data };
        }
    }
    return {};
}

async function deleteTelegramMsg(msgId) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, message_id: msgId })
        });
    } catch (e) { console.error("Del Msg Error:", e); }
}

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
