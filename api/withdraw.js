import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyInitData } from './_tg';

if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const db = getFirestore();

// ================= CẤU HÌNH =================
const MIN_WITHDRAW = 2000000;         // Tối thiểu 50k xu
const ADMIN_CHAT_ID = '8065435277'; // ID Admin nhận tin nhắn
const LOGO_URL = 'https://i.imgur.com/RHlymWn.jpeg'; 
const RATE = 0.001;                 // 1000 xu = 1 VND

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    
    // 2. Nhận dữ liệu
    const { amount, bank_code, account_number, account_name } = req.body;

    // Validate
    if (!amount || amount < MIN_WITHDRAW) {
        return res.status(400).json({ error: 'Số tiền rút tối thiểu 2,000,000 xu' });
    }
    if (!bank_code || !account_number || !account_name) {
        return res.status(400).json({ error: 'Thiếu thông tin ngân hàng' });
    }

    // Tính ra tiền VND thực nhận
    const realAmountVND = Math.floor(amount * RATE); 
    let sentMsgId = null;

    try {
        // 🔥 BƯỚC 1: CHECK SỐ DƯ
        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) throw new Error('User not found');
        
        const userData = userSnap.data();
        if ((userData.balance || 0) < amount) {
            return res.status(400).json({ error: 'Số dư không đủ' });
        }

        // 🔥 BƯỚC 2: GỬI LOGO TRƯỚC (Bỏ username ở đây)
        sentMsgId = await sendTelegramFirst(botToken, LOGO_URL, uid, realAmountVND);
        if (!sentMsgId) throw new Error("Lỗi kết nối Telegram");

        // ✅ Dùng ID tin nhắn làm Mã giao dịch
        const transCode = sentMsgId.toString(); 

        // 🔥 BƯỚC 3: TRỪ TIỀN & LƯU DB
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if ((doc.data().balance || 0) < amount) throw new Error("NOT_ENOUGH_BALANCE");

            // Trừ tiền
            t.update(userRef, { balance: FieldValue.increment(-amount) });

            // Lưu lịch sử
            const historyRef = db.collection('user_social').doc(uid);
            t.set(historyRef, {
                withdrawHistory: FieldValue.arrayUnion({
                    id: transCode,
                    amount: realAmountVND,
                    method: bank_code,
                    address: `${account_number} - ${account_name}`,
                    status: 'pending',
                    created_at: Date.now()
                })
            }, { merge: true });
        });

        // 🔥 BƯỚC 4: BIẾN HÌNH THÀNH QR CODE
        const contentCK = `${uid} SEVQR TyPhuBauTroi ${transCode}`; 
        const safeName = String(account_name).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        // Link VietQR
        const qrUrl = `https://img.vietqr.io/image/${bank_code}-${account_number}-compact.png?amount=${realAmountVND}&addInfo=${encodeURIComponent(contentCK)}&accountName=${encodeURIComponent(safeName)}`;

        // ✅ Gọi hàm KHÔNG CÓ username
        await editTelegramMedia(
            botToken, 
            sentMsgId, 
            qrUrl, 
            uid, 
            realAmountVND, // Tham số này sẽ khớp vào vị trí amountVND
            bank_code, 
            account_number, 
            safeName, 
            contentCK, 
            transCode
        );

        return res.status(200).json({ success: true, message: 'Đã gửi yêu cầu rút tiền' });

    } catch (e) {
        console.error("Withdraw Error:", e);

        // 🔥 BƯỚC 5: NẾU LỖI -> XÓA TIN NHẮN
        if (sentMsgId) {
            await deleteTelegramMsg(botToken, sentMsgId);
        }

        const errorMsg = e.message === "NOT_ENOUGH_BALANCE" ? "Số dư không đủ!" : "Lỗi hệ thống";
        return res.status(400).json({ error: errorMsg });
    }
}

// ================= HELPER FUNCTIONS =================

// 1. Gửi Logo Loading (Đã bỏ tham số thừa)
async function sendTelegramFirst(token, photoUrl, uid, amountVND) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                photo: photoUrl,
                caption: `⏳ <b>KHỞI TẠO ĐƠN RÚT...</b>\n\n` +
                         `👤 UID: ${uid}\n` +
                         `💰 Yêu cầu: <b>${amountVND.toLocaleString()} VND</b>\n` +
                         `⚙️ <i>Đang kiểm tra số dư...</i>`,
                parse_mode: 'HTML'
            })
        });
        const data = await res.json();
        return (data.ok && data.result) ? data.result.message_id : null;
    } catch (e) { return null; }
}

// 2. Edit thành QR (Đã xóa tham số username khỏi định nghĩa hàm)
async function editTelegramMedia(token, msgId, qrUrl, uid, amountVND, bank, accNum, name, content, code) {
    try {
        const caption = `💸 <b>YÊU CẦU RÚT TIỀN: #${code}</b>\n` + 
                        `➖➖➖➖➖➖➖➖➖➖\n` +
                        `👤 User ID: <code>${uid}</code>\n` +
                        `🏦 Ngân hàng: <b>${bank}</b>\n` +
                        `💳 STK: <code>${accNum}</code>\n` +
                        `👤 Tên TK: <b>${name}</b>\n` +
                        `💰 Số tiền: <b>${amountVND.toLocaleString()} VND</b>\n` +
                        `📝 Nội dung CK: <code>${content}</code>\n` +
                        `➖➖➖➖➖➖➖➖➖➖\n` +
                        `👆 <i>Quét mã QR ở trên để thanh toán</i>`; 

        await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                message_id: msgId,
                media: {
                    type: 'photo',
                    media: qrUrl,
                    caption: caption,
                    parse_mode: 'HTML'
                }
            })
        });
    } catch (e) { console.error("Edit Media Error:", e); }
}

// 3. Xóa tin nhắn
async function deleteTelegramMsg(token, msgId) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                message_id: msgId
            })
        });
    } catch (e) { console.error("Del Msg Error:", e); }
}
