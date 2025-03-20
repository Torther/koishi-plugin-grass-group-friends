import { } from "@koishijs/cache";
import {
  Context,
  h,
  isNullable,
  Random,
  Schema,
  Session,
  Time,
  Universal,
} from "koishi";

// 插件名称
export const name = "grass-group-friends";
// 声明插件依赖
export const using = ["cache"];

// 声明缓存表类型
declare module "@koishijs/cache" {
  interface Tables {
    // 群成员信息缓存
    [key: `ggf_members_${string}`]: Universal.GuildMember;
    // 上次使用时间缓存
    [key: `ggf_last_time_${string}`]: number;
    // 上次切换状态时间缓存
    [key: `ggf_toggle_last_time_${string}`]: number;
    // 功能禁用状态缓存
    [key: `ggf_disabled_${string}`]: boolean;
  }
}

// 插件配置接口
export interface Config {
  coolDown: number;         // 命令冷却时间（秒）
  toggleCoolDown: number;   // 开关切换冷却时间（秒）
  blacklist: string[];     // 黑名单群组列表
  messages: {              // 自定义消息文本
    noTarget: string;      // 没有可选目标时的提示
    success: string;       // 操作成功时的提示
    coolDown: string;      // 冷却时间提示
    disabled: string;      // 功能已禁用提示
    cannotTargetSelf: string;  // 不能选择自己作为目标的提示
    targetDisabled: string;    // 目标已禁用功能的提示
    targetNotFound: string;    // 未找到目标的提示
    toggleSuccess: string;     // 切换状态成功的提示
    toggleCoolDown: string;    // 切换状态冷却时间提示
  }
}

// 插件配置Schema
export const Config: Schema<Config> = Schema.object({
  coolDown: Schema.natural().default(3600).description('草群友的冷却时间(秒)'),
  toggleCoolDown: Schema.natural().default(86400).description('用户功能开关冷却时间(秒)'),
  blacklist: Schema.array(Schema.string()).role("table").default([])
    .description('群聊黑名单,格式为 平台:群组ID ,如 onebot:1234567890'),
  messages: Schema.object({
    noTarget: Schema.string().default('没有群友可草……').description('没有可选目标时的提示'),
    success: Schema.string().default('成功草到了 {targetName}({targetId})').description('操作成功时的提示，支持 {targetName} 和 {targetId} 变量'),
    coolDown: Schema.string().default('请等待 {0} 秒后再使用"草群友"指令！！').description('冷却时间提示，{0} 将被替换为冷却时间'),
    disabled: Schema.string().default('你不想被草还想草别人？').description('功能已禁用提示'),
    cannotTargetSelf: Schema.string().default('不能草自己哦~').description('不能选择自己作为目标的提示'),
    targetDisabled: Schema.string().default('对方已开启了防草系统，不能草ta！').description('目标已禁用功能的提示'),
    targetNotFound: Schema.string().default('找不到指定的群友……').description('未找到目标的提示'),
    toggleSuccess: Schema.string().default('已{0}草和被草功能！').description('切换状态成功的提示，{0} 将被替换为"开启"或"关闭"'),
    toggleCoolDown: Schema.string().default('请等待 {0} 秒后再切换状态！！').description('切换状态冷却时间提示，{0} 将被替换为冷却时间')
  }).description('自定义消息文本配置')
}).description('草群友插件配置');

export function apply(ctx: Context, cfg: Config) {
  // 获取群成员列表
  async function getMemberList(session: Session, gid: string) {
    let result: Universal.GuildMember[] = [];
    try {
      // 尝试从API获取群成员列表
      const { data, next } = await session.bot.getGuildMemberList(session.guildId);
      result = data;
      if (next) {
        const { data } = await session.bot.getGuildMemberList(session.guildId, next);
        result.push(...data);
      }
    } catch {
      // API获取失败时从缓存获取
      for await (const value of ctx.cache.values(`ggf_members_${gid}`)) {
        result.push(value);
      }
    }
    return result;
  }

  // 从可用成员中随机选择一个未禁用功能的成员
  async function selectRandomMember(
    members: Universal.GuildMember[],
    gid: string,
    platform: string
  ): Promise<Universal.GuildMember | null> {
    const availableMembers = [...members];
    while (availableMembers.length > 0) {
      const target = Random.pick(availableMembers);
      const isDisabled = await ctx.cache.get(
        `ggf_disabled_${gid}`,
        `${platform}:${target.user.id}`
      );
      if (!isDisabled) return target;
      availableMembers.splice(availableMembers.indexOf(target), 1);
    }
    return null;
  }

  // 获取成员显示信息
  function getMemberInfo(member: Universal.GuildMember, id: string): [string, string] {
    const name = member?.nick || member?.user?.nick || member?.user?.name || id;
    const avatar = member?.avatar || member?.user?.avatar;
    return [name, avatar];
  }

  // 监听消息，缓存群成员信息
  ctx.guild().on("message-created", async (session) => {
    if (isNullable(session.userId)) return;
    const member = session.event.member || { user: session.event.user };
    await ctx.cache.set(
      `ggf_members_${session.gid}`,
      session.userId,
      member,
      2 * Time.day
    );
  });

  // 主命令：草群友
  ctx
    .command("ggf", { authority: 1 })
    .alias("草群友")
    .action(async ({ session }) => {
      if (!session.guildId) return;
      const { gid, uid } = session;

      // 检查群组是否在黑名单中
      if (cfg.blacklist.includes(gid)) return;

      // 检查用户是否已禁用功能
      const isDisabled = await ctx.cache.get(`ggf_disabled_${gid}`, uid);
      if (isDisabled) return cfg.messages.disabled;

      // 检查冷却时间
      const lastTime = await ctx.cache.get(`ggf_last_time_${gid}`, uid);
      const now = Date.now();
      if (lastTime && now - lastTime < cfg.coolDown * 1000) {
        const waitTime = Math.ceil((cfg.coolDown * 1000 - (now - lastTime)) / 1000);
        return cfg.messages.coolDown.replace('{0}', String(waitTime));
      }

      // 获取可选择的群成员列表
      const memberList = await getMemberList(session, gid);
      const availableMembers = memberList.filter(
        (v) => v.user && !v.user.isBot && v.user.id !== uid
      );

      if (availableMembers.length === 0) return cfg.messages.noTarget;

      // 选择一个未禁用功能的目标
      const selected = await selectRandomMember(availableMembers, gid, session.platform);
      if (!selected) return cfg.messages.noTarget;

      const [name, avatar] = getMemberInfo(selected, selected.user.id);
      await ctx.cache.set(`ggf_last_time_${gid}`, uid, now);

      // 构建消息内容
      const quote = h.quote(session.messageId);
      const avatarElement = avatar ? h.image(avatar) : '';
      const message = cfg.messages.success
        .replace('{targetName}', name)
        .replace('{targetId}', selected.user.id);
      
      return h('message', [
        quote,
        message,
        avatarElement
      ]);
    });

  // 指定目标草群友命令
  ctx
    .command("ggf-at <target:user>", { authority: 1 })
    .alias("我想草")
    .action(async ({ session }, targetId) => {
      if (!session.guildId || !targetId) return;
      const { gid, uid } = session;

      // 检查群组是否在黑名单中
      if (cfg.blacklist.includes(gid)) return;

      // 检查用户是否已禁用功能
      const isDisabled = await ctx.cache.get(`ggf_disabled_${gid}`, uid);
      if (isDisabled) return cfg.messages.disabled;

      // 检查目标是否为自己
      if (targetId === uid) return cfg.messages.cannotTargetSelf;

      // 检查目标是否已禁用功能
      const targetDisabled = await ctx.cache.get(`ggf_disabled_${gid}`, `${session.platform}:${targetId}`);
      if (targetDisabled) return cfg.messages.targetDisabled;

      // 检查冷却时间
      const lastTime = await ctx.cache.get(`ggf_last_time_${gid}`, uid);
      const now = Date.now();
      if (lastTime && now - lastTime < cfg.coolDown * 1000) {
        const waitTime = Math.ceil((cfg.coolDown * 1000 - (now - lastTime)) / 1000);
        return cfg.messages.coolDown.replace('{0}', String(waitTime));
      }

      // 获取目标成员信息
      const memberList = await getMemberList(session, gid);
      const targetMember = memberList.find(
        (v) => v.user && v.user.id === targetId.split(":")[1]
      );
      if (!targetMember) return cfg.messages.targetNotFound;

      const [name, avatar] = getMemberInfo(targetMember, targetId);
      await ctx.cache.set(`ggf_last_time_${gid}`, uid, now);

      // 构建消息内容
      const quote = h.quote(session.messageId);
      const avatarElement = avatar ? h.image(avatar) : '';
      const message = cfg.messages.success
        .replace('{targetName}', name)
        .replace('{targetId}', targetId.split(":")[1]);
      
      return h('message', [
        quote,
        message,
        avatarElement
      ]);
    });

  // 禁用功能命令
  ctx
    .command("ggf-off", { authority: 1 })
    .alias("关闭草群友")
    .action(async ({ session }) => handleToggle(session, ctx, cfg, true));

  // 启用功能命令
  ctx
    .command("ggf-on", { authority: 1 })
    .alias("开启草群友")
    .action(async ({ session }) => handleToggle(session, ctx, cfg, false));
}

// 处理功能开关切换
async function handleToggle(session: Session, ctx: Context, cfg: Config, disable: boolean) {
  if (!session.guildId) return;
  const { gid, uid } = session;

  // 检查切换冷却时间
  const lastToggleTime = await ctx.cache.get(`ggf_toggle_last_time_${gid}`, uid);
  const now = Date.now();
  if (lastToggleTime && now - lastToggleTime < cfg.toggleCoolDown * 1000) {
    const waitTime = Math.ceil((cfg.toggleCoolDown * 1000 - (now - lastToggleTime)) / 1000);
    return cfg.messages.toggleCoolDown.replace('{0}', String(waitTime));
  }

  await ctx.cache.set(`ggf_disabled_${gid}`, uid, disable);
  await ctx.cache.set(`ggf_toggle_last_time_${gid}`, uid, now);

  return cfg.messages.toggleSuccess.replace('{0}', disable ? '关闭' : '开启');
}