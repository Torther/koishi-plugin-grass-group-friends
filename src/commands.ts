import { Context, h, Session } from "koishi";
import { GrassService } from "./service";
import { Config } from "./types";

interface CommandArgv {
  session: Session;
  target?: string;
}

export class GrassCommands {
  constructor(private ctx: Context, private service: GrassService, private cfg: Config) {
    this.registerCommands();
  }

  private registerCommands() {
    // 随机草群友指令
    this.ctx.command('ggf', '随机草一位群友')
      .alias("草群友")
      .action(async ({ session }: CommandArgv) => this.handleRandomGrass(session));

    // 关闭被草功能指令
    this.ctx.command('ggf-off', '关闭被草功能')
      .alias('关闭被草')
      .action(async ({ session }: CommandArgv) => this.handleDisableGrass(session));

    // 开启被草功能指令
    this.ctx.command('ggf-on', '开启被草功能')
      .alias('开启被草')
      .action(async ({ session }: CommandArgv) => this.handleEnableGrass(session));

    // 指定草群友指令
    this.ctx.command('ggf-at <target:user>')
      .alias('我要草')
      .action(async ({ session, target }: CommandArgv) => {
        if (!target) return session.text('.invalidTarget');
        return this.handleTargetGrass(session, target);
      });
  }

  // 处理随机草群友
  private async handleRandomGrass(session: Session): Promise<string> {
    try {
      // 检查群聊黑名单
      if (this.cfg.blacklist?.includes(session.gid)) {
        return;
      }

      // 检查用户是否被禁用
      if (await this.service.checkUserDisabled(session, session.userId)) {
        return session.text('.disabled');
      }

      // 检查冷却时间
      const cooldownMessage = await this.service.checkCooldown(session, session.userId, this.cfg.cooldown);
      if (cooldownMessage) return cooldownMessage;

      // 获取群成员列表
      const memberList = await this.service.getMemberList(session, session.gid);
      if (!memberList.length) {
        return session.text('.noMembers');
      }

      // 随机选择目标
      const target = await this.service.getRandomTarget(session, memberList);
      if (!target) {
        return session.text('.noValidTarget');
      }

      // 更新最后使用时间
      await this.service.updateLastUsedTime(session.gid, session.userId);

      // 获取目标信息
      const [name, avatar] = this.service.getMemberInfo(target, target.user.id);

      // 返回结果
      return session.text('.success', {
        quote: h.quote(session.messageId),
        targetName: name,
        targetId: target.user.id,
        avatar: avatar && h.image(avatar),
      });
    } catch (error) {
      this.ctx.logger.error(`[grass-group-friends] 随机草群友失败: ${error.message}`);
      return session.text('.error');
    }
  }

  // 处理禁用草群友
  private async handleDisableGrass(session: Session): Promise<string> {
    try {
      // 检查群聊黑名单
      if (this.cfg.blacklist?.includes(session.gid)) {
        return;
      }

      // 检查是否已经禁用
      if (await this.service.checkUserDisabled(session, session.userId)) {
        return session.text('.alreadyDisabled');
      }

      // 检查冷却时间
      const cooldownMessage = await this.service.checkCooldown(session, session.userId, this.cfg.toggleCooldown);
      if (cooldownMessage) return cooldownMessage;

      // 更新禁用状态
      await this.service.updateUserDisabledState(session.gid, session.userId, true);

      return session.text('.disableSuccess');
    } catch (error) {
      this.ctx.logger.error(`[grass-group-friends] 禁用草群友失败: ${error.message}`);
      return session.text('.error');
    }
  }

  // 处理启用草群友
  private async handleEnableGrass(session: Session): Promise<string> {
    try {
      // 检查群聊黑名单
      if (this.cfg.blacklist?.includes(session.gid)) {
        return;
      }

      // 检查是否已经启用
      if (!(await this.service.checkUserDisabled(session, session.userId))) {
        return session.text('.alreadyEnabled');
      }

      // 检查冷却时间
      const cooldownMessage = await this.service.checkCooldown(session, session.userId, this.cfg.toggleCooldown);
      if (cooldownMessage) return cooldownMessage;

      // 更新禁用状态
      await this.service.updateUserDisabledState(session.gid, session.userId, false);

      return session.text('.enableSuccess');
    } catch (error) {
      this.ctx.logger.error(`[grass-group-friends] 启用草群友失败: ${error.message}`);
      return session.text('.error');
    }
  }

  // 处理指定草群友
  private async handleTargetGrass(session: Session, target: string): Promise<string> {
    try {
      // 检查群聊黑名单
      if (this.cfg.blacklist?.includes(session.gid)) {
        return;
      }

      // 检查用户是否被禁用
      if (await this.service.checkUserDisabled(session, session.userId)) {
        return session.text('.disabled');
      }

      // 检查目标是否被禁用
      if (await this.service.checkUserDisabled(session, target)) {
        return session.text('.targetDisabled');
      }

      // 检查冷却时间
      const cooldownMessage = await this.service.checkCooldown(session, session.userId, this.cfg.cooldown);
      if (cooldownMessage) return cooldownMessage;

      // 获取群成员列表
      const memberList = await this.service.getMemberList(session, session.gid);
      const targetMember = memberList.find(m => m.user?.id === target);

      if (!targetMember) {
        return session.text('.invalidTarget');
      }

      // 更新最后使用时间
      await this.service.updateLastUsedTime(session.gid, session.userId);

      // 获取目标信息
      const [name, avatar] = this.service.getMemberInfo(targetMember, target);

      // 返回结果
      return session.text('.success', {
        quote: h.quote(session.messageId),
        targetName: name,
        targetId: target,
        avatar: avatar && h.image(avatar),
      });
    } catch (error) {
      this.ctx.logger.error(`[grass-group-friends] 指定草群友失败: ${error.message}`);
      return session.text('.error');
    }
  }
}