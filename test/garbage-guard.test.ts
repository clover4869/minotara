/**
 * Guard chống "kiểu chặn trả rác" của Bing, kiểm bằng HTML THẬT.
 *
 * Fixture trong test/fixtures/ là thuộc tính m="{…}" nguyên văn Bing trả về,
 * chụp lúc IP đang bị chặn (đã bỏ phần HTML bao quanh cho gọn). Dữ liệu bịa
 * không bắt được lỗi này: response đủ 30-35 kết quả, HTTP 200, chỉ nội dung
 * là lạc đề — "chair" ra Gardens by the Bay, "chair furniture" ra slide
 * thuyết trình tiếng Nhật.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseBingImages, titleMatchRatio, imageQueryFor } from '../src/services/image-search';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const THRESHOLD = 0.25; // khớp MIN_TITLE_MATCH_RATIO trong image-search.ts

describe('guard rác — HTML Bing thật', () => {
    it('kết quả THẬT: tỉ lệ tiêu đề khớp cao → nhận', () => {
        const r = parseBingImages(fixture('bing-real-dog.html'));
        expect(r.length).toBeGreaterThanOrEqual(5);
        expect(titleMatchRatio(r, 'dog')).toBeGreaterThan(THRESHOLD);
    });

    it('RÁC "chair" → Gardens by the Bay: lọt MIN_TRUSTWORTHY nhưng guard mới LOẠI', () => {
        const r = parseBingImages(fixture('bing-garbage-chair.html'));
        expect(r.length).toBeGreaterThanOrEqual(5);            // đủ số lượng
        expect(titleMatchRatio(r, 'chair')).toBeLessThan(THRESHOLD); // vẫn bị bắt
    });

    it('RÁC nhiều từ "chair furniture" → slide tiếng Nhật: bị LOẠI', () => {
        const r = parseBingImages(fixture('bing-garbage-chair-furniture.html'));
        expect(r.length).toBeGreaterThanOrEqual(5);
        expect(titleMatchRatio(r, 'chair furniture')).toBeLessThan(THRESHOLD);
    });

    it('khớp theo gốc từ: "chairs" tính cho truy vấn "chair"', () => {
        const rows = ['Best Office Chairs 2024', 'Leather Chairs', 'Dining Chairs']
            .map((t) => ({ image: 'a', thumbnail: 'b', title: t, source: '', sourceUrl: '', width: 0, height: 0 }));
        expect(titleMatchRatio(rows, 'chair')).toBe(1);
    });

    it('rỗng → 0; truy vấn toàn từ quá ngắn → 1, không loại oan', () => {
        expect(titleMatchRatio([], 'chair')).toBe(0);
        const one = [{ image: 'a', thumbnail: 'b', title: 'xyz', source: '', sourceUrl: '', width: 0, height: 0 }];
        expect(titleMatchRatio(one, 'an')).toBe(1);
    });
    it('query DÀI kèm định nghĩa: rác vẫn bị LOẠI (từ nối không được tính)', () => {
        // Không lọc stopword thì "the/and/one/with" trong định nghĩa khớp gần
        // như mọi tiêu đề, guard mất tác dụng đúng lúc query dài nhất.
        const q = imageQueryFor('chair', 'a piece of furniture for one person to sit on, with a back, a seat and four legs');
        const r = parseBingImages(fixture('bing-garbage-chair.html'));
        expect(titleMatchRatio(r, q)).toBeLessThan(THRESHOLD);
    });
});

describe('imageQueryFor — từ + cả câu định nghĩa', () => {
    it('ghép định nghĩa vào sau từ', () => {
        expect(imageQueryFor('curling', 'a game played on ice, in which players slide heavy flat stones towards a mark'))
            .toBe('curling a game played on ice, in which players slide heavy flat stones towards a mark');
    });
    it('cắt ở dấu ; — Oxford dùng nó nối nghĩa phụ, phần sau làm loãng truy vấn', () => {
        expect(imageQueryFor('middle', 'the part of something that is at an equal distance from all its edges or sides; a point or a period in the middle of something'))
            .toBe('middle the part of something that is at an equal distance from all its edges or sides');
    });
    it('không có định nghĩa thì trả từ trần', () => {
        expect(imageQueryFor('otter')).toBe('otter');
        expect(imageQueryFor('otter', null)).toBe('otter');
        expect(imageQueryFor('  otter ', '')).toBe('otter');
    });
    it('cắt cứng ở 140 ký tự cho định nghĩa dài bất thường', () => {
        const long = 'x'.repeat(300);
        expect(imageQueryFor('w', long).length).toBe(1 + 1 + 140);
    });
});
