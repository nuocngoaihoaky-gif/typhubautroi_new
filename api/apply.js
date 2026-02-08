import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

const ENERGY_REFILL_COOLDOWN = 15 * 60 * 1000; // 15 phút cooldown xem QC
const MAX_AMOUNT_PER_TX = 1_000_000_000;       // Giới hạn 1 tỷ / lần giao dịch (Chống tràn số)

// ============================================================
// 🔒 HÀM VALIDATE CHẶT CHẼ (Helper)
// ============================================================
function parseStrictAmount(value, min = 1) {
    // 1. Chuyển về string để check ký tự lạ
    const strVal = String(value).trim();

    // 2. Regex: Chỉ cho phép ký tự số từ 0-9. Không dấu chấm (.), không dấu trừ (-), không e (10e5)
    // Nếu có bất kỳ ký tự nào không phải số -> REJECT NGAY
    if (!/^\d+$/.test(strVal)) return null;

    // 3. Chuyển sang Number
    const num = Number(strVal);

    // 4. Check NaN và Finite
    if (isNaN(num) || !isFinite(num)) return null;

    // 5. Check số nguyên an toàn (Dưới 9 triệu tỷ - giới hạn của JS)
    if (!Number.isSafeInteger(num)) return null;

    // 6. Check khoảng giá trị (Min & Max Config)
    if (num < min) return null;
    if (num > MAX_AMOUNT_PER_TX) return null;

    return num;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Auth
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);
    if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

    const uid = String(tgUser.id);
    
    // Lấy type và amount
    const { type, amount } = req.body; 

    const validTypes = ['multitap', 'limit', 'check_ad', 'buy_energy', 'gold_to_diamond'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
    }

    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // ============================================================
        // CASE 1: CHECK XEM QUẢNG CÁO HỒI NĂNG LƯỢNG
        // ============================================================
        if (type === 'check_ad') {
            const walletSnap = await walletRef.once('value');
            const walletData = walletSnap.val() || {};
            const nextRefill = walletData.nextRefillAt || 0;
            const now = Date.now();

            if (now < nextRefill) {
                const remainMin = Math.ceil((nextRefill - now) / 60000);
                return res.status(400).json({ error: `Vui lòng chờ ${remainMin} phút` });
            }
            
            await walletRef.update({ nextRefillAt: now + ENERGY_REFILL_COOLDOWN });
            return res.status(200).json({ ok: true });
        }

        // ============================================================
        // CASE 2: MUA NĂNG LƯỢNG BẰNG KIM CƯƠNG
        // 100 KC = 1000 NL (Min 1000 NL)
        // ============================================================
        if (type === 'buy_energy') {
            // 🔒 VALIDATE INPUT
            const wantEnergy = parseStrictAmount(amount, 1000); // Min 1000
            if (!wantEnergy) {
                return res.status(400).json({ error: 'Số lượng không hợp lệ (Min 1000)' });
            }

            // Tỷ lệ 10 NL = 1 KC (Ví dụ: 1000 NL tốn 100 KC)
            // Dùng Math.ceil để làm tròn lên, tránh user nhập lẻ hòng bug
            const costDiamond = Math.ceil(wantEnergy / 10); 
            
            await walletRef.transaction((data) => {
                if (data) {
                    if ((data.diamond || 0) < costDiamond) throw new Error('NOT_ENOUGH_DIAMOND');
                    
                    data.diamond -= costDiamond;
                    data.energy = (data.energy || 0) + wantEnergy;
                }
                return data;
            });
            
            return res.status(200).json({ ok: true });
        }

        // ============================================================
        // CASE 3: ĐỔI VÀNG SANG KIM CƯƠNG
        // 1000 Vàng = 100 KC (Min 1000 Vàng)
        // ============================================================
        if (type === 'gold_to_diamond') {
            // 🔒 VALIDATE INPUT
            const spendGold = parseStrictAmount(amount, 1000); // Min 1000
            if (!spendGold) {
                return res.status(400).json({ error: 'Số lượng không hợp lệ (Min 1000)' });
            }

            // Tỷ lệ 10 Vàng = 1 KC
            const getDiamond = Math.floor(spendGold / 10); 

            await walletRef.transaction((data) => {
                if (data) {
                    if ((data.balance || 0) < spendGold) throw new Error('NOT_ENOUGH_GOLD');
                    
                    data.balance -= spendGold;
                    data.diamond = (data.diamond || 0) + getDiamond;
                }
                return data;
            });

            return res.status(200).json({ ok: true });
        }

        // ============================================================
        // CASE 4 & 5: NÂNG CẤP (Multitap & Limit) - Dùng Kim Cương
        // ============================================================
        
        const userSnap = await userRef.get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
        const userData = userSnap.data();

        const currentMultitapLv = userData.multitapLevel || 1;
        const currentLimitLv = userData.energyLimitLevel || 1;
        let costDiamond = 0;
        let firestoreUpdates = {};
        let rtdbUpdates = {}; 

        if (type === 'multitap') {
            if (currentMultitapLv > currentLimitLv) {
                return res.status(400).json({ error: `Cần nâng Bình xăng Lv.${currentLimitLv + 1} trước!` });
            }
            // Max Level Check (Nếu có)
            if (currentMultitapLv >= 20) return res.status(400).json({ error: 'Max Level!' });

            costDiamond = 500 * Math.pow(2, currentMultitapLv - 1);
            
            firestoreUpdates = {
                multitapLevel: FieldValue.increment(1),
                tapValue: FieldValue.increment(1)
            };
            rtdbUpdates = { tapValue: (userData.tapValue || 1) + 1 };
        }

        if (type === 'limit') {
            if (currentLimitLv > currentMultitapLv) {
                return res.status(400).json({ error: `Cần nâng Turbo Lv.${currentMultitapLv + 1} trước!` });
            }
            if (currentLimitLv >= 20) return res.status(400).json({ error: 'Max Level!' });

            costDiamond = 500 * Math.pow(2, currentLimitLv - 1);
            
            firestoreUpdates = {
                energyLimitLevel: FieldValue.increment(1),
                baseMaxEnergy: FieldValue.increment(1000)
            };
            rtdbUpdates = { baseMaxEnergy: (userData.baseMaxEnergy || 1000) + 1000 };
        }

        // Trừ tiền bên RTDB (Transaction)
        await walletRef.transaction((data) => {
            if (data) {
                if ((data.diamond || 0) < costDiamond) throw new Error('NOT_ENOUGH_DIAMOND');
                
                data.diamond -= costDiamond;
                
                if (rtdbUpdates.tapValue) data.tapValue = rtdbUpdates.tapValue;
                if (rtdbUpdates.baseMaxEnergy) data.baseMaxEnergy = rtdbUpdates.baseMaxEnergy;
            }
            return data;
        });

        // Update Level bên Firestore
        await userRef.update(firestoreUpdates);

        return res.status(200).json({ ok: true });

    } catch (e) {
        console.error("Apply Error:", e);
        const msg = e.message === 'NOT_ENOUGH_DIAMOND' ? 'Không đủ Kim Cương' : 
                    e.message === 'NOT_ENOUGH_GOLD' ? 'Không đủ Vàng' : e.message;
        return res.status(400).json({ error: msg });
    }
}
