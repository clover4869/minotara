# Minotara — brand palette (lấy trực tiếp từ icon)

| Token | Hex | Dùng ở đâu |
|---|---|---|
| brandTeal | `#6CC6BD` | nền icon, splash background, adaptive background |
| brandDeep | `#4B88A5` | viền ngoài icon, đáy gradient |
| primary | `#0F5F5C` | nút chính (Bắt đầu, Thêm n từ, Ôn ngay) |
| accent | `#0E8F86` | link, icon loa, chữ nhấn trên nền trắng |
| accentSoft | `#E1F4F1` | nền banner "dạng của…" ở SCR-02 |
| accentText | `#0A6B64` | chữ trong banner |
| soft | `#EEF7F5` | nền khối phụ, chip |
| border | `#D6E7E5` | đường kẻ, viền thẻ |
| secondary | `#4C6663` | chữ phụ |
| muted | `#7E9694` | chữ mờ, nhãn |
| brandOrange | `#EA8336` | màu bò — badge/điểm nhấn |
| brandYellow | `#F8C140` | màu sách — highlight |

Gradient icon: `#6CC6BD` (trên) → `#4B88A5` (dưới).
Palette này đã được set trong `src/theme/tokens.ts` (layer `primitive`/`semantic`, light mode) và `app.json` (splash + adaptive icon background). Dark mode không có spec riêng ở đây — các giá trị dark trong `tokens.ts` được suy ra từ palette này (tăng độ sáng, giữ nguyên hue).

Ngoài bảng trên, `theme/tokens.ts` còn dùng thêm 1 màu xanh lá lấy trực tiếp từ tấm thảm dưới chân bò trong icon (`~#80BD46`, không có trong bảng gốc) làm màu success/"Đã nhớ" trong Ôn tập — xem `primitive.green` trong `tokens.ts` nếu cần chỉnh.
