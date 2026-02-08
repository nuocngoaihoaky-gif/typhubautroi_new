import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';
import { verifyInitData } from './_tg';

// ================= FIREBASE INIT =================
if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({ credential: cert(serviceAccount) });
    }
}
const db = getFirestore();

// ================= CONFIG =================
const REGEN_RATE = 3;     // 3 energy / giây
const TICK_MS = 80;       // 80ms / tick
const JWT_SECRET = process.env.JWT_SECRET;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ================= VERIFY TELEGRAM =================
    const initData = req.headers['x-init-data'];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgUser = verifyInitData(initData, botToken);

    if (!tgUser) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const uid = String(tgUser.id);
    const userRef = db.collection('users').doc(uid);

    try {
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            if (!snap.exists) throw new Error('User not found');

            const data = snap.data();
            const now = Date.now();

            // 🚫 CHỐNG DOUBLE START
            if (data.last_energy_update && now < data.last_energy_update) {
                throw new Error('Đang có chuyến bay chưa kết thúc');
            }

            // ================= ENERGY REGEN =================
            const lastUpdate = data.last_energy_update || now;
            const elapsedSeconds = Math.floor((now - lastUpdate) / 1000);

            const maxEnergy = data.baseMaxEnergy || 1000;
            let energyStart = data.energy || 0;

            if (elapsedSeconds > 0 && energyStart < maxEnergy) {
                energyStart = Math.min(
                    energyStart + elapsedSeconds * REGEN_RATE,
                    maxEnergy
                );
            }

            if (energyStart <= 0) {
                throw new Error('Hết năng lượng');
            }

            // ================= RANDOM THỜI GIAN BAY =================
            const rand = Math.random() * 100;
            let randomFlyMs;

            if (rand < 5) {
                randomFlyMs = (1 + Math.random() * 3) * 1000;
            } else if (rand < 25) {
                randomFlyMs = (5 + Math.random() * 10) * 1000;
            } else if (rand < 75) {
                randomFlyMs = (15 + Math.random() * 30) * 1000;
            } else {
                randomFlyMs = (45 + Math.random() * 45) * 1000;
            }

            // ================= ENERGY → THỜI GIAN BAY TỐI ĐA =================
            const tapValue = data.tapValue || 1;
            const maxFlyMs = Math.floor(energyStart / tapValue) * TICK_MS;

            // ================= QUYẾT ĐỊNH CUỐI =================
            let flightMs;
            let mode;

            if (maxFlyMs < randomFlyMs) {
                // ⛽ CẠN NĂNG LƯỢNG TRƯỚC
                flightMs = maxFlyMs;
                mode = 'AUTO';
            } else {
                // 💥 RANDOM TỚI TRƯỚC
                flightMs = randomFlyMs;
                mode = 'CRASH';
            }

            const crashTime = now + flightMs;

            const energyLost = Math.floor(
                (flightMs / TICK_MS) * tapValue
            );

            // Tính năng lượng còn lại SAU KHI TRỪ (để lưu DB)
            const energyAfter = energyStart - energyLost;

            // ================= UPDATE DB =================
            // 🔥 Vẫn lưu số dư ĐÃ TRỪ vào DB (Cơ chế trừ trước giữ nguyên)
            t.update(userRef, {
                energy: energyAfter,
                last_energy_update: crashTime
            });

            return {
                crashTime,
                energyLost,
                mode,
                energyStart, // ✅ Lấy số năng lượng LÚC BẮT ĐẦU (Chưa trừ)
                energyAfter,
                balance: data.balance
            };
        });

        // ================= SIGN PAYLOAD =================
        const payload = jwt.sign(
            {
                uid,
                crashTime: result.crashTime,
                energyLost: result.energyLost,
                mode: result.mode
            },
            JWT_SECRET,
            { expiresIn: '2m' }
        );

        return res.status(200).json({
            ok: true,
            payload,
            // 🔥 QUAN TRỌNG: Trả về energyStart (số đầy) cho Client múa lửa
            // Client nhận số này -> Gán vào UI -> Trừ dần về 0 là vừa đẹp
            energy: result.energyStart, 
            balance: result.balance 
        });

    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
}
