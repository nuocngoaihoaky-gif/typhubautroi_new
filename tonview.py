import os
import json
import time
import requests
import firebase_admin
from firebase_admin import credentials, firestore, db

# ==========================================
# CẤU HÌNH LẤY TỪ BIẾN MÔI TRƯỜNG (GITHUB SECRETS)
# ==========================================
ADMIN_WALLET = os.environ.get("ADMIN_WALLET")
BOT_TOKEN = os.environ.get("BOT_TOKEN")
ADMIN_TELEGRAM_ID = os.environ.get("ADMIN_TELEGRAM_ID")
DATABASE_URL = os.environ.get("DATABASE_URL")
FIREBASE_SERVICE_ACCOUNT = os.environ.get("FIREBASE_SERVICE_ACCOUNT")

USD_TO_KC = 12000
PRICE_SPREAD = 0.03

# Kiểm tra xem có thiếu biến nào không
if not all([ADMIN_WALLET, BOT_TOKEN, ADMIN_TELEGRAM_ID, DATABASE_URL, FIREBASE_SERVICE_ACCOUNT]):
    print("❌ LỖI: Thiếu biến môi trường (Secrets). Hãy kiểm tra lại cấu hình GitHub!")
    exit()

# ==========================================
# KHỞI TẠO FIREBASE BẰNG BIẾN MÔI TRƯỜNG
# ==========================================
try:
    # Biến chuỗi JSON từ Github Secret thành Dictionary
    cred_dict = json.loads(FIREBASE_SERVICE_ACCOUNT)
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred, {
        'databaseURL': DATABASE_URL
    })
    db_fs = firestore.client()
    db_rt = db
    print("✅ Kết nối Firebase thành công!")
except Exception as e:
    print(f"❌ Lỗi kết nối Firebase: {e}")
    exit()

# ==========================================
# HÀM GỬI TIN NHẮN TELEGRAM
# ==========================================
def send_telegram_msg(chat_id, text):
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        requests.post(url, json=payload, timeout=5)
    except Exception as e:
        print(f"⚠️ Lỗi gửi Tele cho {chat_id}: {e}")

# ==========================================
# CHƯƠNG TRÌNH CHÍNH (WORKER)
# ==========================================
def main():
    print("⏳ Đang khởi động Bot Quét TON...")
    
    last_processed_time = 0
    try:
        init_res = requests.get(f"https://tonapi.io/v2/accounts/{ADMIN_WALLET}/events?limit=1", timeout=10).json()
        if 'events' in init_res and len(init_res['events']) > 0:
            last_processed_time = init_res['events'][0]['timestamp']
            print(f"🎯 Mốc bắt đầu quét: {last_processed_time}")
        else:
            last_processed_time = int(time.time())
    except Exception as e:
        print("⚠️ Lỗi mạng, dùng thời gian hiện tại của máy làm mốc.")
        last_processed_time = int(time.time())

    print("🚀 BOT BẮT ĐẦU HOẠT ĐỘNG (Quét 5s/lần)...\n")

    # Tính thời gian chạy để tự tắt trước khi bị GitHub force kill (5 tiếng 30 phút)
    start_time = time.time()
    MAX_RUN_TIME = 5.5 * 3600 

    while True:
        # Nếu chạy quá 5.5 tiếng thì tự ngắt vòng lặp để Github Action kết thúc êm đẹp (tránh bị cờ đỏ)
        if time.time() - start_time > MAX_RUN_TIME:
            print("⏳ Đã chạy đủ 5.5 tiếng. Tự động tắt chờ Cronjob lượt sau gọi dậy!")
            break

        try:
            time.sleep(5)
            res = requests.get(f"https://tonapi.io/v2/accounts/{ADMIN_WALLET}/events?limit=20", timeout=10)
            if res.status_code != 200: continue
            
            data = res.json()
            events = data.get('events', [])
            
            new_events = [e for e in events if e['timestamp'] > last_processed_time]
            new_events.reverse() 

            if not new_events: continue

            ton_price_usd = 0
            is_binance_alive = False
            try:
                binance_res = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT", timeout=5)
                if binance_res.status_code == 200:
                    ton_price_usd = float(binance_res.json()['price'])
                    is_binance_alive = True
            except:
                print("⚠️ Lỗi gọi Binance API.")

            ton_deposit_rate_usd = ton_price_usd * (1 - PRICE_SPREAD)

            for event in new_events:
                if event['timestamp'] > last_processed_time:
                    last_processed_time = event['timestamp']

                actions = event.get('actions', [])
                ton_transfer = next((a for a in actions if a.get('type') == 'TonTransfer' and a.get('status') == 'ok'), None)
                if not ton_transfer: continue

                ton_data = ton_transfer.get('TonTransfer', {})
                receiver = ton_data.get('recipient', {}).get('address', '')
                amount_nano = int(ton_data.get('amount', 0))
                memo = ton_data.get('comment', '')

                if receiver.lower() == ADMIN_WALLET.lower() and memo:
                    ton_received = amount_nano / 1e9
                    uid = str(memo).strip()
                    tx_hash = event['event_id']

                    tx_ref = db_fs.collection('transactions').document(tx_hash)
                    if tx_ref.get().exists: continue

                    user_ref = db_fs.collection('users').document(uid)
                    wallet_ref = db_rt.reference(f"user_wallets/{uid}")
                    wallet_snap = wallet_ref.get()

                    if not wallet_snap: continue 

                    batch = db_fs.batch()

                    if is_binance_alive and ton_price_usd > 0:
                        raw_usd_value = ton_received * ton_deposit_rate_usd
                        safe_usd_value = round((raw_usd_value + 0.01) * 100) / 100.0
                        diamond_gain = int(safe_usd_value * USD_TO_KC)

                        current_diamond = wallet_snap.get('diamond', 0)
                        current_deposited = wallet_snap.get('totalDepositedUSD', 0)

                        batch.set(tx_ref, {
                            'uid': uid, 'type': 'deposit', 'amountTON': ton_received, 'amountUSD': safe_usd_value,
                            'diamondAdded': diamond_gain, 'txHash': tx_hash, 'status': 'success', 'createdAt': int(time.time() * 1000)
                        })

                        user_doc = user_ref.get()
                        user_data = user_doc.to_dict() if user_doc.exists else {}
                        current_history = user_data.get('transactions', [])
                        current_history.insert(0, {'type': 'deposit', 'tonAmount': f"{ton_received:.4f}", 'status': 'success', 'time': int(time.time() * 1000)})
                        
                        batch.set(user_ref, {'transactions': current_history[:50], 'hasDeposited3USD': (current_deposited + safe_usd_value) >= 3}, merge=True)
                        batch.commit()

                        wallet_ref.update({'diamond': current_diamond + diamond_gain, 'totalDepositedUSD': current_deposited + safe_usd_value})
                        print(f"✅ [NẠP AUTO] +{diamond_gain} KC cho ID {uid} (${safe_usd_value})")

                        send_telegram_msg(uid, f"🎉 <b>Deposit Successful!</b>\n\nYou have successfully deposited <b>{ton_received:.4f} TON</b>.\n<b>+{diamond_gain:,} 💎</b> has been added to your balance.")
                        send_telegram_msg(ADMIN_TELEGRAM_ID, f"🔔 <b>NẠP AUTO (WORKER)!</b>\n\n👤 <b>ID:</b> <code>{uid}</code>\n💰 <b>Nạp:</b> {ton_received:.4f} TON\n💵 <b>Giá trị:</b> ~${safe_usd_value:.2f}\n💎 <b>Đã cộng:</b> {diamond_gain:,} KC")

                    else:
                        batch.set(tx_ref, {'uid': uid, 'type': 'deposit', 'amountTON': ton_received, 'amountUSD': 0, 'diamondAdded': 0, 'txHash': tx_hash, 'status': 'pending_manual', 'reason': 'binance_api_failed', 'createdAt': int(time.time() * 1000)})
                        user_doc = user_ref.get()
                        user_data = user_doc.to_dict() if user_doc.exists else {}
                        current_history = user_data.get('transactions', [])
                        current_history.insert(0, {'type': 'deposit', 'tonAmount': f"{ton_received:.4f}", 'status': 'pending', 'time': int(time.time() * 1000)})
                        batch.set(user_ref, {'transactions': current_history[:50]}, merge=True)
                        batch.commit()

                        print(f"⚠️ [TREO ĐƠN] Treo đơn nạp {ton_received} TON của ID {uid}")
                        send_telegram_msg(ADMIN_TELEGRAM_ID, f"⚠️ <b>LỖI BINANCE!</b>\nTreo đơn <b>{ton_received:.4f} TON</b> của ID <code>{uid}</code>.")

        except requests.exceptions.RequestException:
            print("⚠️ Mạng lag, thử lại sau 5s...")
        except Exception as e:
            print(f"❌ Lỗi vòng lặp: {e}")

if __name__ == "__main__":
    main()
