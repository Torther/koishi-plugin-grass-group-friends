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
// 插件依赖
export const using = ["cache"];

// 扩展缓存模块的类型定义
declare module "@koishijs/cache" {
  interface Tables {
    // 群成员信息缓存，格式：ggf_members_群ID:用户ID
    [key: `ggf_members_${string}`]: Universal.GuildMember;
    // 用户最后使用时间缓存，格式：ggf_last_time_群ID:用户ID
    [key: `ggf_last_time_${string}`]: number;
    // 用户切换状态时间缓存，格式：ggf_toggle_last_time_群ID:用户ID
    [key: `ggf_toggle_last_time_${string}`]: number;
    // 用户禁用状态缓存，格式：ggf_disabled_群ID:用户ID
    [key: `ggf_disabled_${string}`]: boolean;
  }
}

// 插件配置接口
export interface Config {
  // 草群友的冷却时间（秒）
  coolDown: number;
  // 切换状态的冷却时间（秒）
  toggleCoolDown: number;
  // 群聊黑名单列表
  blacklist: string[];
}

// 插件配置模式
export const Config: Schema<Config> = Schema.object({
  // 默认冷却时间为1小时
  coolDown: Schema.natural().default(3600),
  // 默认切换状态冷却时间为1天
  toggleCoolDown: Schema.natural().default(86400),
  // 黑名单列表，默认为空
  blacklist: Schema.array(Schema.string()).role("table").default([]),
}).i18n({
  "zh-CN": require("./locales/zh-CN"),
});

export function apply(ctx: Context, cfg: Config) {
  // 注册中文语言包
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  // 监听群消息，更新群成员信息
  // 当有新消息时，将发送者的信息缓存到数据库中
  ctx.guild().on("message-created", async (session) => {
    if (isNullable(session.userId)) return;
    const member: Universal.GuildMember = session.event.member || {
      user: session.event.user,
    };
    // 缓存成员信息，有效期2天
    await ctx.cache.set(
      `ggf_members_${session.gid}`,
      session.userId,
      member,
      2 * Time.day
    );
  });

  // 检查用户是否被禁用
  // 返回 true 表示用户被禁用，false 表示用户未被禁用
  async function checkUserDisabled(session: Session, uid: string): Promise<boolean> {
    const isDisabled = await ctx.cache.get(`ggf_disabled_${session.gid}`, uid);
    if (isDisabled) {
      return true;
    }
    return false;
  }

  // 检查用户是否在冷却时间内
  // 如果在冷却时间内，返回提示信息；否则返回 null
  async function checkCooldown(session: Session, uid: string, cooldown: number): Promise<string | null> {
    const lastTime = await ctx.cache.get(`ggf_last_time_${session.gid}`, uid);
    const now = Date.now();

    if (lastTime && now - lastTime < cooldown * 1000) {
      const waitTime = Math.ceil((cooldown * 1000 - (now - lastTime)) / 1000);
      return session.text(".coolDown", [waitTime]);
    }
    return null;
  }

  // 获取群成员列表
  // 优先从机器人API获取，如果失败则从缓存中获取
  async function getMemberList(session: Session, gid: string): Promise<Universal.GuildMember[]> {
    let result: Universal.GuildMember[] = [];
    try {
      // 尝试从机器人API获取群成员列表
      const { data, next } = await session.bot.getGuildMemberList(session.guildId);
      result = data;
      // 如果还有下一页，继续获取
      if (next) {
        const { data } = await session.bot.getGuildMemberList(session.guildId, next);
        result.push(...data);
      }
    } catch (error) {
      // 如果API获取失败，记录警告日志
      ctx.logger.warn(`获取群成员列表失败: ${error.message}`);
    }
    // 如果API获取失败或结果为空，从缓存中获取
    if (!result.length) {
      for await (const value of ctx.cache.values(`ggf_members_${gid}`)) {
        result.push(value);
      }
    }
    return result;
  }

  // 获取成员信息
  // 返回成员的昵称和头像URL
  function getMemberInfo(member: Universal.GuildMember, id: string): [string, string | undefined] {
    // 优先使用群昵称，其次使用用户昵称，最后使用用户名，都没有则使用ID
    const name = member?.nick || member?.user?.nick || member?.user?.name || id;
    // 获取头像URL
    const avatar = member?.avatar || member?.user?.avatar;
    return [name, avatar];
  }

  // 随机草群友指令
  ctx
    .command("ggf", { authority: 1 })
    .alias("草群友")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;
      // 检查群是否在黑名单中
      if (cfg.blacklist.includes(gid)) return;

      // 检查用户是否被禁用
      if (await checkUserDisabled(session, uid)) {
        return session.text(".disabled");
      }

      // 检查冷却时间
      const cooldownMsg = await checkCooldown(session, uid, cfg.coolDown);
      if (cooldownMsg) return cooldownMsg;

      // 获取群成员列表
      const memberList = await getMemberList(session, gid);
      // 过滤掉机器人和自己
      const list = memberList.filter(
        (v) => v.user && !v.user.isBot && v.user.id !== uid
      );

      if (list.length === 0) return session.text(".members-too-few");

      // 随机选择一个未被禁用的群友
      let target: Universal.GuildMember | null = null;
      while (list.length > 0) {
        target = Random.pick(list);
        if (!(await checkUserDisabled(session, session.platform + ":" + target.user.id))) {
          break;
        }
        list.splice(list.indexOf(target), 1);
        target = null;
      }

      if (!target) return session.text(".members-too-few");

      // 获取目标用户信息并发送结果
      const [name, avatar] = getMemberInfo(target, target.user.id);
      await ctx.cache.set(`ggf_last_time_${gid}`, uid, Date.now());

      return session.text(".success", {
        quote: h.quote(session.messageId),
        targetName: name,
        targetId: target.user.id,
        avatar: avatar && h.image(avatar),
      });
    });

  // 关闭被草功能指令
  ctx
    .command("ggf-off", { authority: 1 })
    .alias("关闭被草")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;
      // 检查切换状态冷却时间
      const cooldownMsg = await checkCooldown(session, uid, cfg.toggleCoolDown);
      if (cooldownMsg) return cooldownMsg;

      // 设置用户为禁用状态
      await ctx.cache.set(`ggf_disabled_${gid}`, uid, true);
      await ctx.cache.set(`ggf_toggle_last_time_${gid}`, uid, Date.now());

      return session.text(".success");
    });

  // 开启被草功能指令
  ctx
    .command("ggf-on", { authority: 1 })
    .alias("开启被草")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;
      // 检查切换状态冷却时间
      const cooldownMsg = await checkCooldown(session, uid, cfg.toggleCoolDown);
      if (cooldownMsg) return cooldownMsg;

      // 设置用户为启用状态
      await ctx.cache.set(`ggf_disabled_${gid}`, uid, false);
      await ctx.cache.set(`ggf_toggle_last_time_${gid}`, uid, Date.now());

      return session.text(".success");
    });

  // 指定草群友指令
  ctx
    .command("ggf-at <target:user>", { authority: 1 })
    .alias("强草")
    .action(async ({ session }, target) => {
      if (!session.guildId) return;

      const { gid, uid } = session;
      // 检查群是否在黑名单中
      if (cfg.blacklist.includes(gid)) return;

      // 检查用户是否被禁用
      if (await checkUserDisabled(session, uid)) {
        return session.text(".disabled");
      }

      // 检查冷却时间
      const cooldownMsg = await checkCooldown(session, uid, cfg.coolDown);
      if (cooldownMsg) return cooldownMsg;

      // 获取群成员列表
      const memberList = await getMemberList(session, gid);
      // 查找目标用户
      const targetMember = memberList.find(
        (v) => v.user && !v.user.isBot && v.user.id === target.id
      );

      // 检查目标用户是否存在
      if (!targetMember) {
        return session.text(".target-not-found");
      }

      // 检查目标用户是否被禁用
      if (await checkUserDisabled(session, session.platform + ":" + target.id)) {
        return session.text(".target-disabled");
      }

      // 获取目标用户信息并发送结果
      const [name, avatar] = getMemberInfo(targetMember, targetMember.user.id);
      await ctx.cache.set(`ggf_last_time_${gid}`, uid, Date.now());

      return session.text(".success", {
        quote: h.quote(session.messageId),
        targetName: name,
        targetId: targetMember.user.id,
        avatar: avatar && h.image(avatar),
      });
    });
}
