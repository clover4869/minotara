/**
 * Stub `react-native` cho vitest. Node không parse được react-native/index.js
 * (Flow syntax), nên bất kỳ service nào import từ đó sẽ làm vỡ cả file test —
 * kể cả khi test không hề đụng tới phần native.
 *
 * Chỉ khai những gì service thật sự dùng. Thiếu cái gì thì test sẽ báo undefined
 * ngay, chứ không âm thầm chạy sai.
 */
export const Platform = {
    OS: 'android' as const,
    select<T>(spec: { ios?: T; android?: T; native?: T; default?: T }): T | undefined {
        return spec.android ?? spec.native ?? spec.default;
    },
};
