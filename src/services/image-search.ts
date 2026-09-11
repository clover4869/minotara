/**
 * Image search — tab "Ảnh".
 *
 * Nguồn: endpoint ảnh của Bing. Không có API công khai nào miễn phí và không
 * cần key cho việc này, nên đây vẫn là đọc HTML của một endpoint không tài
 * liệu — cùng loại rủi ro như mọi thứ trước đó. Xử lý y như
 * services/vi-meaning.ts xử lý API ngoài của nó: cache trước, timeout, thử
 * lại một lần, hỏng thì im, không bao giờ throw ra UI.
 *
 * ---- Vì sao không còn dùng DuckDuckGo ----
 *
 * Bản trước gọi `duckduckgo.com/i.js` theo hai bước (tải HTML lấy token `vqd`
 * rồi mới gọi JSON). Endpoint đó giờ trả 403. Bắt request thật của trình duyệt
 * thì thấy nó đã thêm ba tham số nữa: `jsa`, `jsa_hash`, `dp` — chữ ký chống
 * bot do chính JS của trang tính lúc chạy. Không phải sai tham số hay sai
 * User-Agent: đã thử bỏ UA, đổi UA, thêm cookie jar, đủ bộ Sec-Fetch-*, tất cả
 * đều 403. Muốn giữ DuckDuckGo thì phải đọc ngược thuật toán ký của họ rồi cài
 * lại ở đây, và làm lại mỗi lần họ đổi — đúng thứ mà cơ chế đó sinh ra để cản.
 *
 * Thư viện `ddgs` (Python) trông như vẫn chạy, nhưng đọc source thì
 * `duckduckgo_images.py` gửi y hệt bộ tham số cũ và cũng dính 403; nó không
 * lỗi chỉ vì `backend="auto"` nuốt exception rồi rơi sang engine Bing. Tức là
 * kết quả "DuckDuckGo" của nó thực ra là của Bing.
 *
 * Chuyển thẳng sang Bing vì vậy không mất gì về chất lượng: ảnh của DuckDuckGo
 * vốn lấy từ Bing. Kiểm chứng bằng cách so ba kết quả đầu của truy vấn "otter"
 * ở hai bên — trùng khớp từng tiêu đề.
 */
import { Platform } from 'react-native';

import type { DbLike } from '../db/types';
import { getCachedImages, cacheImages } from '../db/user';

const SEARCH_URL = 'https://www.bing.com/images/async';

/**
 * 8s. Chỉ còn một request (bản DuckDuckGo cần hai), nhưng response là trang
 * HTML ~320KB nên vẫn cần rộng tay: 3s như vi-meaning.ts thì 4G trượt timeout,
 * mà timeout lại hiện ra thành lỗi khiến người dùng đi kiểm tra mạng.
 */
const TIMEOUT_MS = 8000;

/**
 * Cache ảnh KHÔNG hết hạn.
 *
 * Trước đây để 30 ngày, lý do là "endpoint chết rồi mà cache cũ vẫn có ảnh
 * thì nhìn như lỗi ngắt quãng". Lý do đó đã hết giá trị từ khi mỗi ô ảnh tự
 * nhảy sang link khác lúc link chết và chỉ gọi mạng lại khi cạn ảnh dự phòng
 * (xem components/resilient-image.tsx): link hỏng giờ được phát hiện bằng
 * việc nó hỏng thật, không phải bằng việc đoán theo tuổi.
 *
 * Và hết hạn theo thời gian lại tự tạo ra một vấn đề khác: nguồn ảnh có lúc
 * chặn, nên đúng ngày cache hết hạn mà Bing đang chặn thì một từ đang có ảnh
 * tử tế bỗng thành không có gì.
 */
const CACHE_KEEP = 12;

/**
 * User-Agent PHẢI khai đúng nền tảng đang chạy. Trước đây chỗ này khai
 * "Chrome trên Windows" cho mọi máy — và đó là nguyên nhân gốc của lỗi "Nguồn
 * ảnh đang không phản hồi" xảy ra trên MỌI điện thoại, MỌI mạng:
 *
 * Bing đứng sau Akamai, bên này đối chiếu lời khai trong User-Agent với dấu
 * vân tay TLS của kết nối. Từ điện thoại, vân tay là Android/OkHttp trong khi
 * UA khai là Chrome/Windows — mâu thuẫn đó là dấu hiệu bot kinh điển, và cái
 * app nhận về là trang cụt (~25KB, 1 kết quả) hoặc trang đủ số lượng nhưng
 * nội dung của truy vấn khác hẳn (tra "apple" ra bài về hồ Summit Lake).
 * Cả hai đều HTTP 200, không captcha, không chữ nào báo bị chặn.
 *
 * Đo 12 lần/biến thể, tiêu chí = đúng tiêu chí guard bên dưới (>=5 kết quả VÀ
 * >=25% tiêu đề khớp):
 *
 *   UA Android  12/12 = 100%   trang 166KB đều tăm tắp, mọi cấu hình
 *   UA Windows  11/12 =  92%   dao động 154KB, có lần rơi xuống 25KB
 *
 * 92% đó là đo TỪ MÁY LINUX, nơi UA desktop còn khớp nền tảng. Trên điện
 * thoại mâu thuẫn luôn tồn tại nên tỉ lệ hỏng cao hơn hẳn — khớp với việc
 * người dùng gặp lỗi cả trên máy khác lẫn mạng khác.
 *
 * Vì vậy: đừng đổi UA này sang chuỗi desktop cho "trông giống trình duyệt
 * hơn". Giống nền tảng THẬT mới là thứ đi lọt.
 */
const USER_AGENT = Platform.select({
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});

/**
 * Gọi dồn dập thì Bing trả một trang cụt ~24KB chỉ có đúng 1 kết quả, vẫn
 * HTTP 200 và không có captcha hay chữ nào báo bị chặn. Nhận về 1 tấm ảnh
 * chẳng liên quan còn tệ hơn là báo lỗi — với app học từ, ảnh sai làm người
 * học nhớ sai. Nên dưới ngưỡng này thì coi là thất bại: không cache, cho bấm
 * thử lại. Đổi lại, từ nào hiếm tới mức Bing thật sự chỉ có 4 ảnh cũng bị coi
 * là lỗi; các từ trong từ điển đều là từ tiếng Anh thông dụng nên trường hợp
 * đó gần như không xảy ra, còn bị chặn tốc độ thì xảy ra thật.
 */
const MIN_TRUSTWORTHY = 5;

/**
 * Bing còn một kiểu chặn thứ hai, nguy hiểm hơn kiểu trang cụt: nó trả ĐỦ
 * 30-35 kết quả, HTTP 200, nhưng nội dung hoàn toàn không liên quan tới truy
 * vấn — đo thật từ IP đã bị chặn: "chair" trả ảnh con trút và Gardens by the
 * Bay, "chair furniture" trả slide thuyết trình tiếng Nhật. Kiểu này LỌT QUA
 * MIN_TRUSTWORTHY, được cache 30 ngày, và người học thấy con trút khi tra
 * "chair" — sai mà không ai biết là sai.
 *
 * Cách nhận: kết quả thật gần như luôn có từ khoá trong tiêu đề ("16 Best
 * Amazon Office Chairs", "The 21 Happiest Otters Ever", "Apple | Fruit,
 * Types, Nutrition"), còn rác thì không có lấy một cái. Ngưỡng 25% đặt thấp
 * hẳn so với thực tế (từ thật thường trên 70%) để không bao giờ loại oan ảnh
 * đúng chỉ vì tiêu đề không nhắc tên.
 */
const MIN_TITLE_MATCH_RATIO = 0.25;

/**
 * Kiểu chặn trang cụt không phải trạng thái bền — nó chập chờn theo TỪNG
 * request độc lập, không theo từ khoá. Đo thật: gọi CÙNG một truy vấn 8 lần
 * liên tiếp, cách nhau 300ms — số kết quả ra 1, 30, 12, 59, 1, 35, 12, 35.
 * Đã thử thêm header giả trình duyệt (Referer, sec-fetch-*, sec-ch-ua) và
 * cookie phiên Bing thật — không đổi tỉ lệ, nên đây không phải chỗ header
 * thiếu mà sửa được. Với ~50% khả năng một request đơn lẻ bị chặn, 2 lần thử
 * độc lập (bản trước) vẫn còn ~25% khả năng cả hai đều trượt; 3 lần hạ xuống
 * ~12%. Có nghỉ ngắn kèm jitter giữa các lần thử — không phải để "chờ Bing
 * hồi", vì dữ liệu trên cho thấy 300ms là đủ để ra kết quả tốt ở lần kế tiếp;
 * jitter chỉ để nhiều thiết bị đang thử lại cùng lúc không dội trùng nhịp vào
 * đúng cùng một cửa sổ bị chặn.
 */
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
const RETRY_DELAY_JITTER_MS = 400;

/**
 * Từ nối phải loại khỏi phép so khớp. Truy vấn giờ mang cả câu định nghĩa nên
 * chứa "the/and/one/with/that…" — để nguyên thì "the" khớp gần như mọi tiêu đề
 * và guard mất tác dụng đúng lúc cần nhất.
 */
const STOP = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'have',
    'one', 'two', 'its', 'his', 'her', 'you', 'your', 'they', 'them', 'not', 'but',
    'all', 'any', 'can', 'out', 'off', 'over', 'into', 'used', 'use', 'such', 'other',
    'someone', 'something', 'somebody', 'etc', 'who', 'which', 'when', 'where', 'what',
]);

/**
 * Có bao nhiêu phần kết quả nhắc tới từ trong truy vấn ở tiêu đề. So khớp theo
 * gốc từ (bỏ 's'/'es' cuối) nên "chairs" vẫn tính cho "chair".
 *
 * Dùng `.some()` chứ không đòi khớp từ chính: truy vấn kèm định nghĩa có thể
 * dẫn tới kết quả đúng nghĩa mà KHÔNG chứa từ chính — "middle + the part … at
 * an equal distance" ra sơ đồ "midpoint and distance", không có chữ "middle"
 * nào. Đòi khớp từ chính là loại oan đúng những ca định nghĩa làm tốt việc.
 */
export function titleMatchRatio(results: ImageResult[], query: string): number {
    if (!results.length) return 0;
    /*
      Cắt hậu tố NHƯNG không để lọt mẩu quá ngắn.

      Lọc `length >= 3` phải chạy CẢ SAU khi cắt, không chỉ trước. Thiếu bước
      đó thì "toes" → "to", và `.includes("to")` khớp gần như mọi tiêu đề tiếng
      Anh — Story, History, Photo, October. Guard coi như không tồn tại đúng ở
      những truy vấn dài nhất, tức là những truy vấn dễ bị trả lạc đề nhất.

      Đã dính thật: nghĩa của "otter" có "(= with skin between the toes)", nên
      guard chấm 100% cho một trang toàn bìa sách và đem cache luôn.
    */
    const stem = (w: string) => {
        const cut = w.replace(/(es|s)$/i, '');
        return cut.length >= 3 ? cut : w;
    };
    const needles = query.toLowerCase().split(/[^a-z0-9'-]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map(stem)
        .filter((w) => w.length >= 3);
    if (!needles.length) return 1; // không có gì để so — đừng loại
    const hit = results.filter((r) => {
        const t = r.title.toLowerCase();
        return needles.some((n) => t.includes(n));
    }).length;
    return hit / results.length;
}

/**
 * Truy vấn ảnh = từ + CẢ CÂU định nghĩa. Đo trên Bing (kênh trình duyệt, vì
 * IP máy dev đang bị chặn endpoint async):
 *
 *   apple   trần → logo Apple, MacBook Air, iPhone event
 *   apple   +def → "A Shiny, Red Apple with Smooth Skin", "Round Ripe Apple"
 *   curling trần → wallpaper, "Mopping Olympic Sport"
 *   curling +def → "Athletes Sliding The Stones In Curling", "Players Slide
 *                   Stones Towards Target"
 *   chair   +def → ghế gỗ bốn chân (trần cũng tốt, không bị phá)
 *   middle  +def → sơ đồ midpoint/distance (đúng nghĩa, thay vì sitcom)
 *
 * Vì sao câu đầy đủ ăn mà CỤM TỪ KHOÁ RỜI thì không: "apple round fruit shiny"
 * vẫn ra Apple Inc, "red apple fruit on tree" trôi sang bảng màu đỏ. Bing so
 * khớp ngữ nghĩa trên câu tự nhiên, và ảnh stock có alt-text mô tả cũng là
 * câu — nên câu khớp câu. Chuỗi từ khoá rời chỉ làm loãng.
 *
 * Cắt ở dấu `;` vì Oxford dùng nó để nối nghĩa phụ ("…all its edges or sides;
 * a point or a period in the middle of something") — phần sau làm loãng truy
 * vấn. Cắt cứng ở 140 ký tự cho vài định nghĩa dài bất thường.
 */
export function imageQueryFor(word: string, definition?: string | null): string {
    const w = word.trim();
    if (!definition) return w;
    const first = definition.split(';')[0].replace(/\s+/g, ' ').trim().slice(0, 140);
    return first ? `${w} ${first}` : w;
}

export interface ImageResult {
    image: string;
    thumbnail: string;
    title: string;
    source: string;
    sourceUrl: string;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Metadata nằm trong thuộc tính `m="{…}"` của HTML nên dấu nháy trong JSON bị
 * escape thành `&quot;`. Chỉ giải mã đúng những thực thể thật sự xuất hiện
 * (`&quot;`, `&amp;`, và dạng số) — không kéo cả thư viện HTML entity vào chỉ
 * để đọc một thuộc tính.
 */
function unescapeAttr(s: string): string {
    return s
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, '&'); // cuối cùng, không thì '&amp;quot;' ra sai
}

function hostOf(url: string): string {
    const m = /^https?:\/\/([^/?#]+)/i.exec(url);
    return m ? m[1].replace(/^www\./, '') : '';
}

/**
 * Bóc kết quả từ HTML. Mỗi ảnh là một thẻ có `m="{…}"` chứa JSON:
 *   murl = ảnh gốc, turl = thumbnail (CDN Bing), t/desc = tiêu đề,
 *   purl = trang nguồn.
 * Dùng regex chứ không parse DOM: React Native không có DOMParser, mà thứ cần
 * lấy là một thuộc tính có ranh giới rõ ràng chứ không phải cấu trúc cây.
 */
export function parseBingImages(html: string): ImageResult[] {
    const out: ImageResult[] = [];
    const re = /\sm="(\{[^"]+\})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        let d: any;
        try {
            d = JSON.parse(unescapeAttr(m[1]));
        } catch {
            continue; // một thẻ hỏng không được làm hỏng cả trang
        }
        const image = typeof d?.murl === 'string' ? d.murl : '';
        const thumbnail = typeof d?.turl === 'string' ? d.turl : '';
        if (!image || !thumbnail) continue;
        const sourceUrl = typeof d?.purl === 'string' ? d.purl : '';
        out.push({
            image,
            thumbnail,
            title: d?.t ?? d?.desc ?? '',
            source: hostOf(sourceUrl),
            sourceUrl,
        });
    }
    return out;
}

/**
 * Cache-first fetch. Fail soft, không bao giờ throw ra UI — cùng hợp đồng với
 * getViMeanings() trong vi-meaning.ts. `fetchImpl` tiêm vào để test.
 *
 * `failed: true` chỉ có nghĩa "không lấy được ảnh", KHÔNG có nghĩa mất mạng:
 * nó bật lên cho cả HTTP lỗi, timeout, bị chặn tốc độ, HTML đổi cấu trúc. Chỗ
 * gọi phải tự kiểm tra mạng trước khi nói với người dùng là do mạng — nói sai
 * nguyên nhân thì họ đi sửa Wi-Fi trong khi lỗi nằm ở nguồn ảnh.
 */
export interface ImageSearchOut {
    results: ImageResult[];
    fromCache: boolean;
    failed: boolean;
}

/**
 * Gộp các lời gọi trùng đang chạy: màn chi tiết prefetch ngay khi mở từ, và
 * nếu người dùng bấm tab Ảnh trong lúc đó thì WordImages gọi cùng query —
 * không có map này là hai request Bing giống hệt nhau bắn song song, vừa phí
 * vừa tăng nguy cơ dính chặn tốc độ (Bing chặn thì trả trang cụt, xem
 * MIN_TRUSTWORTHY). Xoá khỏi map trong finally nên thất bại không bị ghim.
 */
const inflight = new Map<string, Promise<ImageSearchOut>>();

/**
 * Khoảng cách tối thiểu giữa hai lần GỌI MẠNG tới Bing.
 *
 * Tab "Ảnh" chỉ gọi khi người dùng mở một từ, nên nhịp tự nhiên đã thưa. Chế
 * độ trắc nghiệm thì khác: một phiên ôn có tới 40 thẻ, mỗi thẻ một câu hỏi
 * kèm ảnh — không giãn thì đó là 40 request liên tiếp, đúng cách để dính lại
 * kiểu chặn "trả đủ số lượng nhưng lạc đề" đã mất cả buổi để tìm ra.
 *
 * 700ms là chọn theo nhịp người dùng: trả lời một câu trắc nghiệm mất vài
 * giây, nên hàng đợi gần như không bao giờ có hơn một hai mục chờ, và tab
 * "Ảnh" không bị kẹt sau việc tải nền. Đặt trên đường gọi mạng chứ không đặt
 * ở chỗ gọi: cache đọc xong trả ngay, không phải đứng chờ ai.
 */
const MIN_REQUEST_GAP_MS = 700;
let minRequestGapMs = MIN_REQUEST_GAP_MS;
let lastRequestAt = 0;

/** Đổi khoảng giãn nhịp. Test đặt 0 để khỏi ngủ thật — để nguyên 700ms thì
 *  bộ test tốn thêm ~6 giây mỗi lần chạy, toàn bộ là chờ suông. */
export function setImageRequestGap(ms: number): void {
    minRequestGapMs = Math.max(0, ms);
}
/** Nối đuôi nhau — mỗi lời gọi chờ lời gọi trước rồi mới tính giãn nhịp của
 *  mình, nên N request đồng thời ra thành N nhịp cách nhau đều. */
let gate: Promise<void> = Promise.resolve();

function throttleNetwork(): Promise<void> {
    const mine = gate.then(async () => {
        const wait = lastRequestAt + minRequestGapMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastRequestAt = Date.now();
    });
    // Lỗi ở một mắt không được làm đứt cả chuỗi cho những mắt sau.
    gate = mine.catch(() => {});
    return mine;
}

export interface SearchOpts {
    page?: number;
    /**
     * Bỏ qua cache, lấy mới và ghi đè. Dùng khi MỌI link đã cache đều chết —
     * lúc đó cache không còn giá trị gì, giữ lại chỉ để hiện ô ảnh vỡ.
     */
    forceRefresh?: boolean;
    /** Tiêm để test. */
    fetchImpl?: typeof fetch;
}

export async function searchImages(
    userDb: DbLike,
    rawQuery: string,
    opts: SearchOpts = {},
): Promise<ImageSearchOut> {
    const page = opts.page ?? 1;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const fresh = !!opts.forceRefresh;
    const query = rawQuery.trim().toLowerCase();
    if (!query) return { results: [], fromCache: false, failed: false };
    const key = `${query}\u0000${page}`;
    // `fresh` nằm trong khoá gộp: một lời gọi "lấy mới" không được nhận lại
    // kết quả của lời gọi "đọc cache" đang chạy — nó gọi lại chính vì kết quả
    // trong cache đã vô dụng.
    const flightKey = fresh ? `${key} fresh` : key;
    const running = inflight.get(flightKey);
    if (running) return running;
    const p = doSearch(userDb, query, page, fetchImpl, fresh);
    inflight.set(flightKey, p);
    try {
        return await p;
    } finally {
        inflight.delete(flightKey);
    }
}

async function doSearch(
    userDb: DbLike,
    query: string,
    page: number,
    fetchImpl: typeof fetch,
    forceRefresh: boolean,
): Promise<ImageSearchOut> {
    // Không truyền maxAgeMs: cache ảnh không hết hạn nữa (xem CACHE_KEEP).
    const cached = forceRefresh ? null : await getCachedImages(userDb, query, page);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            // Mảng rỗng là hàng cache vô dụng — đi lấy mới, thay vì trả về
            // "thành công, 0 ảnh" rồi để UI hiện khoảng trống vĩnh viễn.
            if (Array.isArray(parsed) && parsed.length) {
                return { results: parsed, fromCache: true, failed: false };
            }
        } catch {
            // hàng cache hỏng — đi lấy mới thay vì báo lỗi luôn
        }
    }

    const count = 35;
    // mkt/setlang ghim kết quả về thị trường Anh-Mỹ. Không có thì Bing bản địa
    // hoá theo IP: từ Việt Nam, "middle" trả rdsic.edu.vn ("The Middle: Giải
    // Thích, Cách Sử Dụng"), blog tiếng Hung, ảnh người vùng Nam Á — app từ
    // điển Anh-Anh mà minh hoạ bằng nội dung bản địa thì lạc đề. Đây cũng
    // đúng là lý do DuckDuckGo trông "đỡ hơn": nó chuẩn hoá về tiếng Anh, dù
    // ảnh vốn lấy từ cùng chỉ mục Bing.
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&async=1`
        + `&first=${(page - 1) * count + 1}&count=${count}&mkt=en-US&setlang=en`;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        try {
            await throttleNetwork();
            const res = await fetchWithTimeout(fetchImpl, url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const results = parseBingImages(await res.text());
            if (results.length < MIN_TRUSTWORTHY) throw new Error(`chỉ ${results.length} kết quả`);
            const ratio = titleMatchRatio(results, query);
            if (ratio < MIN_TITLE_MATCH_RATIO) {
                throw new Error(`kết quả lạc đề (${Math.round(ratio * 100)}% tiêu đề khớp)`);
            }
            // Lưu 12 chứ không lưu cả 35: 9 cái cho lưới tab Ảnh, còn lại là
            // dự phòng cho lúc link chết. Cache giờ sống vĩnh viễn và ghi theo
            // TỪNG NGHĨA, nên một từ nhiều nghĩa như `take` (43 nghĩa) mà lưu
            // cả 35 ảnh mỗi nghĩa là hàng trăm KB cho một từ.
            const keep = results.slice(0, CACHE_KEEP);
            await cacheImages(userDb, query, page, JSON.stringify(keep));
            return { results: keep, fromCache: false, failed: false };
        } catch {
            if (attempt === RETRY_ATTEMPTS - 1) return { results: [], fromCache: false, failed: true };
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS + Math.random() * RETRY_DELAY_JITTER_MS));
        }
    }
    return { results: [], fromCache: false, failed: true };
}
