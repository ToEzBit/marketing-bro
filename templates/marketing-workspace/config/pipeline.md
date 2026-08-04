---
status: unfilled        # เปลี่ยนเป็น ready เมื่อเติม target_page แล้ว
target_page: ""         # ชื่อเพจ Facebook + URL เช่น "Aisoft Thailand — https://www.facebook.com/aisoftthailand"
platforms: [facebook]   # แพลตฟอร์มที่เปิดโพสต์ (v1 มีแค่ facebook)
drafts_per_run: 2       # content-maker สร้าง draft สูงสุดกี่ชิ้นต่อรอบ
max_posts_per_day: 2    # fb-publisher โพสต์สูงสุดกี่ชิ้นต่อวัน (กันเพจสแปม)
trends_per_run: 5       # trend-scout บันทึก trend สูงสุดกี่เรื่องต่อรอบ
archive_after_days: 30  # ไฟล์ที่จบงานแล้วอายุเกินนี้ถูกย้ายเข้า archive/ (ห้ามต่ำกว่า 7 — trends/ คือหน้าต่างกันเทรนด์ซ้ำของ trend-scout)
---

# ค่าตั้งของ pipeline

แก้ค่าใน frontmatter ด้านบนได้เลย ทุก skill อ่านไฟล์นี้ตอนเริ่มรอบ

- `target_page` ต้องเป็นเพจที่บัญชีที่ล็อกอินใน browser ของบอทเป็น admin
- เพิ่มแพลตฟอร์มใหม่ในอนาคต: เพิ่มค่าใน `platforms` + สร้าง `brand/voice/<platform>.md` + ต้องมี skill โพสต์ของแพลตฟอร์มนั้นก่อน
