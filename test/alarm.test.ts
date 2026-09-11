import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DbLike } from '../src/db/types';
import { migrateUserDb, getAlarm, setAlarm, logAlarmEvent, recentAlarmEvents, ALARM_DEFAULT } from '../src/db/user';
import { setSetting } from '../src/db/user';

function wrap(db: Database.Database): DbLike {
    return {
        getAllAsync: async (sql, ...p) => db.prepare(sql).all(...p) as any[],
        getFirstAsync: async (sql, ...p) => (db.prepare(sql).get(...p) ?? null) as any,
        runAsync: async (sql, ...p) => ({ changes: db.prepare(sql).run(...p).changes }),
        execAsync: async (sql) => { db.exec(sql); },
        closeAsync: async () => { db.close(); },
    };
}

let user: DbLike;
beforeEach(async () => {
    user = wrap(new Database(':memory:'));
    await migrateUserDb(user);
});

describe('cấu hình báo thức', () => {
    it('chưa cấu hình bao giờ thì trả mặc định và mặc định là TẮT', async () => {
        const cfg = await getAlarm(user);
        expect(cfg).toEqual(ALARM_DEFAULT);
        expect(cfg.enabled).toBe(false);
    });

    it('ghi rồi đọc lại ra đúng cái đã ghi', async () => {
        const mine = { enabled: true, hour: 6, minute: 30, days: [1, 4], target: 10, kind: 'review' as const };
        await setAlarm(user, mine);
        expect(await getAlarm(user)).toEqual(mine);
    });

    /**
     * Những ca dưới đây đều dẫn tới cùng một triệu chứng nếu không chặn: báo
     * thức kêu sai giờ hoặc sai ngày, mà người dùng chỉ phát hiện vào sáng
     * hôm sau và không có cách nào lần ra nguyên nhân.
     */
    it('JSON hỏng thì rơi về mặc định chứ không ném lỗi', async () => {
        await setSetting(user, 'alarm', '{khong-phai-json');
        expect(await getAlarm(user)).toEqual(ALARM_DEFAULT);
    });

    it('giờ/phút ngoài khoảng bị kẹp về biên', async () => {
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, hour: 99, minute: -5 }));
        const cfg = await getAlarm(user);
        expect(cfg.hour).toBe(23);
        expect(cfg.minute).toBe(0);
    });

    it('loại thứ không hợp lệ, và nếu không còn thứ nào thì dùng mặc định', async () => {
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, days: [0, 3, 9, 7] }));
        expect((await getAlarm(user)).days).toEqual([3, 7]);

        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, days: [0, 99] }));
        expect((await getAlarm(user)).days).toEqual(ALARM_DEFAULT.days);
    });

    it('kiểu bài lạ thì về trắc nghiệm', async () => {
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, kind: 'khong-ton-tai' }));
        expect((await getAlarm(user)).kind).toBe('quiz');
    });

    it('số câu đúng bị kẹp trong 1..30 — 0 câu là báo thức tắt được mà không làm gì', async () => {
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, target: 0 }));
        expect((await getAlarm(user)).target).toBe(1);
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, target: 9999 }));
        expect((await getAlarm(user)).target).toBe(30);
    });

    it('days không phải mảng thì không làm vỡ', async () => {
        await setSetting(user, 'alarm', JSON.stringify({ enabled: true, days: 'thứ hai' }));
        expect((await getAlarm(user)).days).toEqual(ALARM_DEFAULT.days);
    });
});

describe('nhật ký báo thức', () => {
    it('ghi và đọc lại theo thứ tự mới nhất trước', async () => {
        await logAlarmEvent(user, 'fired');
        await logAlarmEvent(user, 'completed');
        const rows = await recentAlarmEvents(user, 5);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'fired']);
    });

    it('giới hạn số dòng trả về', async () => {
        for (let i = 0; i < 8; i++) await logAlarmEvent(user, 'fired');
        expect(await recentAlarmEvents(user, 3)).toHaveLength(3);
    });
});
