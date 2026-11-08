# App-Flashdrive-Desktop (FlashdriveHome)

หน้าโฮมแบบแท็บเล็ต Android สำหรับแฟลชไดรฟ์ สร้างด้วย [Tauri 2](https://tauri.app) ไฟล์ `.exe` เดียว ขนาดประมาณ 3.5 MB
ใช้ WebView2 ที่มีอยู่แล้วใน Windows 10/11 ไม่ต้องติดตั้ง และไม่ต้องแตกไฟล์ทุกครั้งที่เปิด

## ใช้งานบนแฟลชไดรฟ์ (Windows 10/11)

1. คัดลอก `FlashdriveHome.exe` ไปไว้ในแฟลชไดรฟ์ (ไว้ที่ไหนในไดรฟ์ก็ได้)
2. ดับเบิลคลิก แอปจะสแกนทั้งไดรฟ์ที่ตัวมันอยู่

| ฟีเจอร์ | รายละเอียด |
|---|---|
| หน้าโฮม | ไอคอนจริงของแอป `.exe .lnk .bat .cmd .url` (ลึก 2 ชั้นโฟลเดอร์ ซ่อนตัวติดตั้ง/ถอนการติดตั้ง), ค้นหา, นาฬิกา |
| แกลเลอรี | อัลบั้มแยกตามโฟลเดอร์, ดูเต็มจอ (← → / ปัดนิ้ว), ปุ่มเปิดโฟลเดอร์ |
| วอลเปเปอร์ | ตั้งจากรูปเดียว หรือเลือกหลายรูปเป็นสไลด์โชว์ (ตั้งเวลาเปลี่ยนรูปได้) |
| เพลง / วิดีโอ | อัลบั้มตามโฟลเดอร์, ใช้ player ตัวเดียวกัน, วิดีโอเลือกดูภาพ หรือซ่อนภาพฟังแต่เสียงก็ได้ |
| Player | มินิเพลเยอร์มุมขวาล่าง, คิว (เพิ่ม / ดู / ข้าม / ลบ), วนซ้ำทั้งคิว / เพลงเดียว / ปิด, ปุ่มมีเดียบนคีย์บอร์ด |
| พับเป็น overlay | ย่อทั้งแอปเป็นเพลเยอร์เล็ก always-on-top เล่นต่อไม่สะดุด ลากย้ายได้ |
| ตั้งค่า | ตำแหน่ง overlay (4 มุม / กลางขอบซ้าย-ขวา), ซ่อนตามขอบจอ (หลบเข้าขอบเหลือแถบสี ชี้เมาส์เพื่อดึงกลับ), เวลาสไลด์โชว์ |

ไอคอนใช้ [Phosphor Icons](https://phosphoricons.com) (MIT): แบบ duotone สำหรับแอป/อัลบั้ม และ mono สำหรับปุ่มควบคุม ฝังเป็น SVG sprite ใน `ui/index.html`

การตั้งค่า (วอลเปเปอร์, โหมดวนซ้ำ, ดู/ซ่อนวิดีโอ, ตำแหน่ง overlay) เก็บใน `.flashdrivehome.json` ข้าง exe จึงติดไปกับแฟลชไดรฟ์
และเก็บรูปเป็น path แบบ relative ใช้ได้แม้อักษรไดรฟ์เปลี่ยน (E: → F:)

ไฟล์ที่รองรับ: รูป `jpg png gif webp bmp`, เพลง `mp3 m4a aac wav ogg flac opus`, วิดีโอ `mp4 m4v webm mov mkv ogv` (เล่นได้ตามที่ WebView2 รองรับ)

## ดาวน์โหลด

ไฟล์ `FlashdriveHome.exe` สร้างอัตโนมัติด้วย GitHub Actions (`.github/workflows/release.yml`) บน Windows
ดาวน์โหลดได้จากหน้า **Releases** ของ repo

ออก release ใหม่: push tag เวอร์ชัน เช่น `git tag v0.4.0 && git push origin v0.4.0`
(หรือกด Run workflow ในแท็บ Actions เพื่อได้ exe เป็น artifact โดยไม่สร้าง release)

## พัฒนา

ต้องมี Rust; บน Linux ต้องมี `libwebkit2gtk-4.1-dev`

```
cd src-tauri
cargo run -- --root=/path/to/drive          # เลือกโฟลเดอร์ที่จะสแกน (ค่าเริ่มต้นตอน dev = โฟลเดอร์ปัจจุบัน)
cargo test                                  # ทดสอบตัวสแกนไฟล์
# สร้าง exe สำหรับ Windows จาก Linux (ต้องมี mingw-w64):
rustup target add x86_64-pc-windows-gnu
cargo build --release --target x86_64-pc-windows-gnu
# -> target/x86_64-pc-windows-gnu/release/flashdrive-home.exe
```

โค้ดหน้าตาอยู่ใน `ui/` (HTML/JS ล้วน ไม่มี build step) และฝั่ง Rust อยู่ใน `src-tauri/src/main.rs`
