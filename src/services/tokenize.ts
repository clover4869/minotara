/**
 * Tách văn bản thành từ cho tính năng "double-tap để tra" ở màn chi tiết.
 * Tách khỏi component vì test chạy bằng Node không import được react-native.
 */

/**
 * Trả về mảng xen kẽ [ngoài-từ, từ, ngoài-từ, từ, …] — nhờ capture group trong
 * split, PHẦN TỬ LẺ LUÔN LÀ TỪ. Không ký tự nào bị vứt, nên ghép lại ra đúng
 * chuỗi gốc và câu hiển thị y hệt như khi chưa tách.
 *
 * "Từ" là chữ cái Latin (kèm dấu — café) + nháy/gạch nối bên trong: "don't",
 * "well-known" là MỘT từ. Nháy dùng làm ngoặc ('word') sẽ dính vào token,
 * normalizeWord() gọt sau.
 */
export function splitWords(text: string): string[] {
    return text.split(/([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*)/);
}

/** Gọt nháy/gạch bám mép token rồi hạ chữ thường — "'Food'" → "food". */
export function normalizeWord(w: string): string {
    return w.replace(/^['’-]+|['’-]+$/g, '').toLowerCase();
}
