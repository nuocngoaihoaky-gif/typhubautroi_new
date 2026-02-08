import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CẤU HÌNH =================
const MIN_WITHDRAW = 2000000;
const ADMIN_CHAT_ID = '8065435277';
const LOGO_URL = 'https://i.imgur.com/RHlymWn.jpeg'; 
const RATE = 0.001; 

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Xác thực
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    
    // 2. Nhận dữ liệu & Validate sơ bộ
    let { amount, bank_code, account_number, account_name } = req.body;

    if (!amount || amount < MIN_WITHDRAW) return res.status(400).json({ error: 'Số tiền rút tối thiểu 2,000,000 xu' });
    if (!bank_code || !account_number || !account_name) return res.status(400).json({ error: 'Thiếu thông tin ngân hàng' });

    // Chuẩn hóa dữ liệu để tạo ID (xóa khoảng trắng)
    bank_code = bank_code.trim().toUpperCase();
    account_number = account_number.trim();
    account_name = account_name.trim().toUpperCase();

    // ID định danh duy nhất cho tài khoản ngân hàng này
    const bankDocId = `${bank_code}_${account_number}`;

    const userRef = db.collection('users').doc(uid);
    const bankRegRef = db.collection('bank_registry').doc(bankDocId);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);
    const socialRef = db.collection('user_social').doc(uid);

    // Biến cờ đánh dấu đây có phải lần đầu liên kết bank không
    let isNewBankBind = false;

    try {
        // ============================================================
        // 🔥 BƯỚC 1: CHECK THÔNG TIN USER (Tốn 1 Read)
        // ============================================================
        const userSnap = await userRef.get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        
        const userData = userSnap.data();
        const savedBank = userData.bank_info;

        if (savedBank) {
            // A. NGƯỜI CŨ: Đã có bank -> Bắt buộc dùng bank cũ (Chống cheat đổi bank liên tục)
            // Hoặc nếu bác cho phép đổi thì phải check trùng lại. 
            // Ở đây theo logic của bác: "Có info rồi thì thôi" -> Dùng luôn thông tin cũ để rút
            if (savedBank.account_number !== account_number || savedBank.bank_code !== bank_code) {
                 return res.status(400).json({ error: 'Thông tin ngân hàng không khớp với dữ liệu đã lưu!' });
            }
            // Không tốn thêm Read nào nữa
        } else {
            // B. NGƯỜI MỚI: Chưa có bank -> Check trùng bên Registry (Tốn thêm 1 Read)
            const bankRegSnap = await bankRegRef.get();
            
            if (bankRegSnap.exists) {
                // Đã có thằng khác dùng số này rồi -> CÚT
                return res.status(400).json({ error: 'Tài khoản ngân hàng này đã được liên kết với ví khác!' });
            }
            
            // Bank sạch -> Đánh dấu để lát nữa lưu
            isNewBankBind = true;
        }

        // ============================================================
        // 🔥 BƯỚC 2: TRỪ TIỀN & XỬ LÝ (Logic cũ)
        // ============================================================
        const realAmountVND = Math.floor(amount * RATE); 
        
        // Gửi Telegram báo Admin (Lấy Message ID làm mã đơn)
        const sentMsgId = await sendTelegramFirst(botToken, LOGO_URL, uid, realAmountVND);
        if (!sentMsgId) throw new Error("Lỗi kết nối Telegram");
        const transCode = sentMsgId.toString();

        // Trừ tiền RTDB
        await walletRef.transaction((data) => {
            if (data) {
                if ((data.balance || 0) < amount) throw new Error('NOT_ENOUGH_BALANCE');
                data.balance -= amount;
            }
            return data;
        });

        // ============================================================
        // 🔥 BƯỚC 3: LƯU DATA (WRITE)
        // ============================================================
        
        const batch = db.batch(); // Dùng Batch để ghi 1 lần cho an toàn

        // 1. Lưu lịch sử rút tiền
        batch.update(socialRef, {
            withdrawHistory: FieldValue.arrayUnion({
                id: transCode,
                amount: realAmountVND,
                amountGold: amount,
                method: bank_code,
                address: `${account_number} - ${account_name}`,
                status: 'pending',
                created_at: Date.now()
            })
        });

        // 2. Nếu là NGƯỜI MỚI -> Lưu Bank vào Profile & Đăng ký vào Registry
        if (isNewBankBind) {
            // Update vào User Profile
            batch.update(userRef, {
                bank_info: {
                    bank_code,
                    account_number,
                    account_name
                }
            });

            // Tạo doc bên bank_registry để xí chỗ (Chống trùng sau này)
            batch.set(bankRegRef, {
                uid: uid,
                created_at: Date.now()
            });
        }

        await batch.commit();

        // ============================================================
        // 🔥 BƯỚC 4: SỬA TIN NHẮN TELEGRAM (QR CODE)
        // ============================================================
        const contentCK = `${transCode} TyPhuBauTroi ${uid}`; 
        const safeName = String(account_name).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const qrUrl = `https://img.vietqr.io/image/${bank_code}-${account_number}-compact.png?amount=${realAmountVND}&addInfo=${encodeURIComponent(contentCK)}&accountName=${encodeURIComponent(safeName)}`;

        await editTelegramMedia(botToken, sentMsgId, qrUrl, uid, realAmountVND, bank_code, account_number, safeName, contentCK, transCode);

        return res.status(200).json({ success: true, message: 'Đã gửi yêu cầu rút tiền' });

    } catch (e) {
        console.error("Withdraw Error:", e);
        const errorMsg = e.message === "NOT_ENOUGH_BALANCE" ? "Số dư không đủ!" : "Lỗi hệ thống";
        return res.status(400).json({ error: errorMsg });
    }
}

// ================= HELPER FUNCTIONS =================
// (Giữ nguyên như cũ)
async function sendTelegramFirst(token, photoUrl, uid, amountVND) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                photo: photoUrl,
                caption: `⏳ <b>KHỞI TẠO ĐƠN RÚT...</b>\nUID: ${uid}\nSố tiền: ${amountVND.toLocaleString()} VND`,
                parse_mode: 'HTML'
            })
        });
        const data = await res.json();
        return (data.ok && data.result) ? data.result.message_id : null;
    } catch (e) { return null; }
}

async function editTelegramMedia(token, msgId, qrUrl, uid, amountVND, bank, accNum, name, content, code) {
    try {
        const caption = `💸 <b>YÊU CẦU RÚT TIỀN: #${code}</b>\n➖➖➖➖➖\nUser ID: <code>${uid}</code>\nBank: <b>${bank}</b> - <code>${accNum}</code>\nTên: <b>${name}</b>\nSố tiền: <b>${amountVND.toLocaleString()} VND</b>\nNội dung: <code>${content}</code>\n➖➖➖➖➖\n👆 Quét QR để chuyển khoản`; 
        await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                message_id: msgId,
                media: { type: 'photo', media: qrUrl, caption: caption, parse_mode: 'HTML' }
            })
        });
    } catch (e) { console.error("Edit Media Error:", e); }
}
