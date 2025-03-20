import { } from '@koishijs/cache';
import { Schema, Universal } from 'koishi';

// 缓存表类型定义
declare module '@koishijs/cache' {
  interface Tables {
    ggf_members_: Universal.GuildMember;
    ggf_last_time_: number;
    ggf_toggle_last_time_: number;
    ggf_disabled_: boolean;
  }
}

// 插件配置接口
export interface Config {
  cooldown?: number;
  toggleCooldown?: number;
  blacklist?: string[];
}

// 配置模式
export const Config = Schema.object({
  cooldown: Schema.number()
    .description('指令冷却时间（秒）')
    .default(60),
  toggleCooldown: Schema.number()
    .description('开关冷却时间（秒）')
    .default(60),
  blacklist: Schema.array(Schema.string())
    .description('黑名单列表')
    .default([]),
}); 