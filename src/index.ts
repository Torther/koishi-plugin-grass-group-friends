import { Context } from "koishi";
import { GrassCommands } from "./commands";
import zhCN from './locales/zh-CN.yml';
import { GrassService } from "./service";
import { Config } from "./types";

// 插件名称
export const name = "grass-group-friends";
// 插件依赖
export const using = ["cache"];

// 导出配置
export { Config };

// 插件入口函数
export function apply(ctx: Context, cfg: Config) {
  // 注册中文语言包
  ctx.i18n.define("zh-CN", zhCN);

  // 创建服务实例
  const service = new GrassService(ctx, cfg);

  // 创建命令处理器实例
  const commands = new GrassCommands(ctx, service, cfg);

  // 监听群消息，更新群成员信息
  ctx.on('message', async (session) => {
    if (!session.guildId) return;
    await service.updateMemberInfo(session);
  });
}
