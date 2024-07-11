import {
  Context,
  Schema,
  h,
  Universal,
  Time,
  isNullable,
  Random,
  Session,
} from "koishi";
import {} from "@koishijs/cache";

export const name = "grass-group-friends";
export const using = ["cache"];

declare module "@koishijs/cache" {
  interface Tables {
    [key: `ggf_members_${string}`]: Universal.GuildMember;
    [key: `ggf_last_time_${string}`]: number;
    [key: `ggf_toggle_last_time_${string}`]: number;
    [key: `ggf_disabled_${string}`]: boolean;
  }
}

export interface Config {
  coolDown: number;
  toggleCoolDown: number;
  blacklist: string[];
}

export const Config: Schema<Config> = Schema.object({
  coolDown: Schema.natural().default(3600),
  toggleCoolDown: Schema.natural().default(86400),
  blacklist: Schema.array(Schema.string()).role("table").default([]),
}).i18n({
  "zh-CN": require("./locales/zh-CN"),
});

export function apply(ctx: Context, cfg: Config) {
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  ctx.guild().on("message-created", async (session) => {
    if (isNullable(session.userId)) return;
    const member: Universal.GuildMember = session.event.member || {
      user: session.event.user,
    };
    await ctx.cache.set(
      `ggf_members_${session.gid}`,
      session.userId,
      member,
      2 * Time.day
    );
  });

  ctx
    .command("ggf", { authority: 1 })
    .alias("草群友")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;
      if (cfg.blacklist.includes(gid)) {
        return;
      }

      const isDisabled = await ctx.cache.get(`ggf_disabled_${gid}`, uid);
      if (isDisabled) {
        return session.text(".disabled");
      }

      const lastTime = await ctx.cache.get(`ggf_last_time_${gid}`, uid);
      const now = Date.now();

      if (lastTime && now - lastTime < cfg.coolDown * 1000) {
        const waitTime = Math.ceil(
          (cfg.coolDown * 1000 - (now - lastTime)) / 1000
        );
        return session.text(".coolDown", [waitTime]);
      }

      const memberList = await getMemberList(session, gid);
      const list = memberList.filter(
        (v) => v.user && !v.user.isBot && v.user.id !== uid
      );

      if (list.length === 0) return session.text(".members-too-few");

      async function select(): Promise<Universal.GuildMember> {
        let target;
        while (list.length > 0) {
          target = Random.pick(list);
          const isDisabled = await ctx.cache.get(
            `ggf_disabled_${gid}`,
            session.platform + ":" + target.user.id
          );
          if (!isDisabled) {
            break;
          }
          // 从列表中移除已被禁用的用户
          list.splice(list.indexOf(target), 1);
          target = null;
        }
        return target;
      }

      const selected = await select();

      const [name, avatar] = getMemberInfo(selected, selected.user.id);

      await ctx.cache.set(`ggf_last_time_${gid}`, uid, now);

      return session.text(".success", {
        quote: h.quote(session.messageId),
        targetName: name,
        targetId: selected.user.id,
        avatar: avatar && h.image(avatar),
      });
    });

  ctx
    .command("ggf-off", { authority: 1 })
    .alias("我不想被草了")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;

      const lastToggleTime = await ctx.cache.get(
        `ggf_toggle_last_time_${gid}`,
        uid
      );
      const now = Date.now();

      if (lastToggleTime && now - lastToggleTime < cfg.toggleCoolDown * 1000) {
        const waitTime = Math.ceil(
          (cfg.toggleCoolDown * 1000 - (now - lastToggleTime)) / 1000
        );
        return session.text(".toggle-coolDown", [waitTime]);
      }

      await ctx.cache.set(`ggf_disabled_${gid}`, uid, true);
      await ctx.cache.set(`ggf_toggle_last_time_${gid}`, uid, now);

      return session.text(".disable-success");
    });

  ctx
    .command("ggf-on", { authority: 1 })
    .alias("我又想被草了")
    .action(async ({ session }) => {
      if (!session.guildId) return;

      const { gid, uid } = session;

      const lastToggleTime = await ctx.cache.get(
        `ggf_toggle_last_time_${gid}`,
        uid
      );
      const now = Date.now();

      if (lastToggleTime && now - lastToggleTime < cfg.toggleCoolDown * 1000) {
        const waitTime = Math.ceil(
          (cfg.toggleCoolDown * 1000 - (now - lastToggleTime)) / 1000
        );
        return session.text(".toggle-coolDown", [waitTime]);
      }

      await ctx.cache.set(`ggf_disabled_${gid}`, uid, false);
      await ctx.cache.set(`ggf_toggle_last_time_${gid}`, uid, now);

      return session.text(".enable-success");
    });

  async function getMemberList(session: Session, gid: string) {
    let result: Universal.GuildMember[] = [];
    try {
      const { data, next } = await session.bot.getGuildMemberList(
        session.guildId
      );
      result = data;
      if (next) {
        const { data } = await session.bot.getGuildMemberList(
          session.guildId,
          next
        );
        result.push(...data);
      }
    } catch {}
    if (!result.length) {
      for await (const value of ctx.cache.values(`ggf_members_${gid}`)) {
        result.push(value);
      }
    }
    return result;
  }
}

function getMemberInfo(member: Universal.GuildMember, id: string) {
  const name = member?.nick || member?.user?.nick || member?.user?.name || id;
  const avatar = member?.avatar || member?.user?.avatar;
  return [name, avatar];
}
