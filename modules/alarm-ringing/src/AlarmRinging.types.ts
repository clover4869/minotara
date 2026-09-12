/**
 * 1 = Chủ nhật … 7 = Thứ bảy — đúng quy ước `Calendar.DAY_OF_WEEK` phía native
 * (Android) và cũng là quy ước `AlarmConfig.days` đang dùng ở db/user.ts, nên
 * không cần chuyển đổi qua lại giữa JS và Kotlin.
 */
export type AlarmWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
