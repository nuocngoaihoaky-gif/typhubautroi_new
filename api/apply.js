import { db, rtdb, verifyInitData } from './_lib';
import { FieldValue } from 'firebase-admin/firestore';

const ENERGY_REFILL_COOLDOWN = 15 * 60 * 1000; 
const MAX_AMOUNT_PER_TX = 1_000_000_000;       

// Helper Validate
function parseStrictAmount(value, min = 1) {
    const strVal = String(value).trim();
    if (!/^\d+$/.test(strVal)) return null;
    const num = Number(strVal);
    if (isNaN(num) || !isFinite(num)) return null;
    if (!Number.isSafeInteger(num)) return null;
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
    const { type, amount } = req.body; 

    const validTypes = ['multitap', 'limit', 'check_ad', 'buy_energy', 'gold_to_diamond'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });

    const userRef = db.collection('users').doc(uid);
    const walletRef = rtdb.ref(`user_wallets/${uid}`);

    try {
        // ============================================================
        // CASE 1: CHECK AD (Giữ nguyên)
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
        // CASE 2: MUA NĂNG LƯỢNG (INPUT LÀ SỐ KIM CƯƠNG)
        // 1 KC = 10 NL (Min 100 KC)
        // ============================================================
        if (type === 'buy_energy') {
            // 🔒 Input là số KC muốn chi (Min 100 KC)
            const spendDiamond = parseStrictAmount(amount, 100); 
            if (!spendDiamond) {
                return res.status(400).json({ error: 'Tối thiểu 100 Kim Cương' });
            }

            // Tính lượng năng lượng nhận được: 1 KC = 10 NL
            const energyReceive = spendDiamond * 10;
            
            await walletRef.transaction((data) => {
                if (data) {
                    if ((data.diamond || 0) < spendDiamond) throw new Error('NOT_ENOUGH_DIAMOND');
                    
                    data.diamond -= spendDiamond;
                    // Cộng năng lượng (cho phép vượt max)
                    data.energy = (data.energy || 0) + energyReceive;
                }
                return data;
            });
            
            return res.status(200).json({ ok: true });
        }

        // ============================================================
        // CASE 3: ĐỔI VÀNG SANG KIM CƯƠNG (INPUT LÀ SỐ VÀNG)
        // 10 Vàng = 1 KC (Min 1000 Vàng)
        // ============================================================
        if (type === 'gold_to_diamond') {
            // 🔒 Input là số Vàng muốn đổi (Min 1000 Vàng)
            const spendGold = parseStrictAmount(amount, 1000); 
            if (!spendGold) {
                return res.status(400).json({ error: 'Tối thiểu 1000 Vàng' });
            }

            // Tính lượng KC nhận được: 10 Vàng = 1 KC
            const diamondReceive = Math.floor(spendGold / 10); 

            await walletRef.transaction((data) => {
                if (data) {
                    if ((data.balance || 0) < spendGold) throw new Error('NOT_ENOUGH_GOLD');
                    
                    data.balance -= spendGold;
                    data.diamond = (data.diamond || 0) + diamondReceive;
                }
                return data;
            });

            return res.status(200).json({ ok: true });
        }

        // ============================================================
        // CASE 4 & 5: NÂNG CẤP (Giữ nguyên)
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

        await walletRef.transaction((data) => {
            if (data) {
                if ((data.diamond || 0) < costDiamond) throw new Error('NOT_ENOUGH_DIAMOND');
                data.diamond -= costDiamond;
                if (rtdbUpdates.tapValue) data.tapValue = rtdbUpdates.tapValue;
                if (rtdbUpdates.baseMaxEnergy) data.baseMaxEnergy = rtdbUpdates.baseMaxEnergy;
            }
            return data;
        });

        await userRef.update(firestoreUpdates);

        return res.status(200).json({ ok: true });

    } catch (e) {
        console.error("Apply Error:", e);
        const msg = e.message === 'NOT_ENOUGH_DIAMOND' ? 'Không đủ Kim Cương' : 
                    e.message === 'NOT_ENOUGH_GOLD' ? 'Không đủ Vàng' : e.message;
        return res.status(400).json({ error: msg });
    }
}
