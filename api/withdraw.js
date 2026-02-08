import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

// ================= CẤU HÌNH =================
const MIN_WITHDRAW = 2000000;
const ADMIN_CHAT_ID = '8065435277';
const LOGO_URL = 'https://i.imgur.com/RHlymWn.jpeg';
const RATE = 0.001;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ================= 1. XÁC THỰC =================
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const uid = String(tgUser.id);

    // ================= 2. NHẬN DATA =================
    let { amount, bank_code, account_number, account_name } = req.body;

    const withdrawAmount = Number(amount); // 🔥 ÉP KIỂU

    if (!withdrawAmount || withdrawAmount < MIN_WITHDRAW) {
        return res.status(400).json({ error: 'Số tiền rút tối thiểu 2,000,000 xu' });
    }
    if (!bank_code || !account_number || !account_name) {
        return res.status(400).json({ error: 'Thiếu thông tin ngân hàng' });
    }

    if (!/^\d{6,20}$/.test(account_number)) {
        return res.status(400).json({ error: 'Số tài khoản không hợp lệ' });
    }

    const realAmountVND = Math.floor(withdrawAmount * RATE);
    const bankKey = `${bank_code}_${account_number}`;

    const userRef = db.collection('users').doc(uid);
    const bankIndexRef = db.collection('bank_index').doc(bankKey);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);
    const socialRef = db.collection('user_social').doc(uid);

    let sentMsgId = null;

    try {
        // ================= 3. LẤY USER PROFILE =================
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};
        const existedBank = userData?.bank_info?.bank_key;

        // ================= 4. CHECK / LOCK BANK =================
        if (!existedBank) {
            await db.runTransaction(async (tx) => {
                const bankSnap = await tx.get(bankIndexRef);
                if (bankSnap.exists) {
                    throw new Error('BANK_USED');
                }

                tx.set(bankIndexRef, {
                    uid,
                    created_at: Date.now()
                });

                tx.update(userRef, {
                    bank_info: {
                        bank_code,
                        account_number,
                        account_name: account_name.toUpperCase(),
                        bank_key: bankKey
                    }
                });
            });
        }

        // ================= 5. GỬI TIN ADMIN (CHỜ) =================
        sentMsgId = await sendTelegramFirst(
            botToken,
            LOGO_URL,
            uid,
            realAmountVND
        );
        if (!sentMsgId) throw new Error('TELEGRAM_FAIL');

        const transCode = sentMsgId.toString();

        // ================= 6. TRỪ TIỀN (REALTIME DB) =================
        let committed = false;

        await walletRef.transaction(
            (data) => {
                if (!data || typeof data.balance !== 'number') {
                    return; // abort
                }

                if (data.balance < withdrawAmount) {
                    return; // abort
                }

                data.balance -= withdrawAmount;
                return data;
            },
            (error, success) => {
                if (error) {
                    throw error;
                }
                committed = success;
            }
        );

        if (!committed) {
            throw new Error('NOT_ENOUGH_BALANCE');
        }

        // ================= 7. LƯU LỊCH SỬ =================
        await socialRef.update({
            withdrawHistory: FieldValue.arrayUnion({
                id: transCode,
                amount: realAmountVND,
                amountGold: withdrawAmount,
                method: bank_code,
                address: `${account_number} - ${account_name}`,
                status: 'pending',
                created_at: Date.now()
            })
        });

        // ================= 8. TẠO QR =================
        const contentCK = `${uid} SEVQR TyPhuBauTroi ${transCode}`;
        const safeName = String(account_name)
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const qrUrl =
            `https://img.vietqr.io/image/${bank_code}-${account_number}-compact.png` +
            `?amount=${realAmountVND}` +
            `&addInfo=${encodeURIComponent(contentCK)}` +
            `&accountName=${encodeURIComponent(safeName)}`;

        await editTelegramMedia(
            botToken,
            sentMsgId,
            qrUrl,
            uid,
            realAmountVND,
            bank_code,
            account_number,
            safeName,
            contentCK,
            transCode
        );

        return res.status(200).json({
            success: true,
            message: 'Đã gửi yêu cầu rút tiền'
        });

    } catch (e) {
        console.error('Withdraw Error:', e);

        if (sentMsgId) {
            await deleteTelegramMsg(botToken, sentMsgId);
        }

        let msg = 'Lỗi hệ thống';
        if (e.message === 'BANK_USED') msg = 'Tài khoản ngân hàng đã được sử dụng';
        if (e.message === 'NOT_ENOUGH_BALANCE') msg = 'Số dư không đủ';

        return res.status(400).json({ error: msg });
    }
}

// ================= HELPER =================

async function sendTelegramFirst(token, photoUrl, uid, amountVND) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                photo: photoUrl,
                caption:
                    `⏳ <b>KHỞI TẠO ĐƠN RÚT...</b>\n\n` +
                    `👤 UID: ${uid}\n` +
                    `💰 Yêu cầu: <b>${amountVND.toLocaleString()} VND</b>\n` +
                    `⚙️ <i>Đang xử lý...</i>`,
                parse_mode: 'HTML'
            })
        });
        const data = await res.json();
        return data.ok ? data.result.message_id : null;
    } catch {
        return null;
    }
}

async function editTelegramMedia(
    token,
    msgId,
    qrUrl,
    uid,
    amountVND,
    bank,
    accNum,
    name,
    content,
    code
) {
    try {
        const caption =
            `💸 <b>YÊU CẦU RÚT TIỀN: #${code}</b>\n` +
            `➖➖➖➖➖➖➖➖➖➖\n` +
            `👤 User ID: <code>${uid}</code>\n` +
            `🏦 Ngân hàng: <b>${bank}</b>\n` +
            `💳 STK: <code>${accNum}</code>\n` +
            `👤 Tên TK: <b>${name}</b>\n` +
            `💰 Số tiền: <b>${amountVND.toLocaleString()} VND</b>\n` +
            `📝 Nội dung CK: <code>${content}</code>\n` +
            `➖➖➖➖➖➖➖➖➖➖\n` +
            `👆 <i>Quét mã QR để thanh toán</i>`;

        await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                message_id: msgId,
                media: {
                    type: 'photo',
                    media: qrUrl,
                    caption,
                    parse_mode: 'HTML'
                }
            })
        });
    } catch (e) {
        console.error('Edit Media Error:', e);
    }
}

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
    } catch (e) {
        console.error('Delete Msg Error:', e);
    }
}
