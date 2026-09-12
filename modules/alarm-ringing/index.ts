// Re-export the native module. On web, it will be resolved to AlarmRingingModule.web.ts
// and on native platforms to AlarmRingingModule.ts
export { default } from './src/AlarmRingingModule';
export * from './src/AlarmRinging.types';
