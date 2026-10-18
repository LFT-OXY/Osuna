import type {
  HostCommand,
  HostCommandResult,
  HostProcess,
  HostProcesses,
  HostProcessesError,
  HostProgram,
} from "../api-endpoints/host-processes.js";
import { NO_SYSTEM_PROXY, type SystemProxy } from "../api-endpoints/system-proxy.js";

/** 假的 codex：执行命令时记下的程序路径，从不真的去找、去跑。 */
export const FAKE_CODEX_PATH = "/fake/bin/codex";

/**
 * 假的「进程与命令」：列出用例给的进程，记下执行过的命令、回用例给的结果，什么都不真的跑。
 * 测试 daemon 缺省就用它（paseo-daemon.ts），真的实现在测试里一造就抛错。
 */
export class FakeHostProcesses implements HostProcesses {
  reportsStartTimes = true;
  processes: HostProcess[] = [];
  // 按 pid 给的 CODEX_HOME；没给的当作读不到。
  codexHomes = new Map<number, string>();
  runs: HostCommand[] = [];
  lists = 0;
  // 设了就让 list 抛它（问不到系统）。
  listError: HostProcessesError | null = null;
  runResult: HostCommandResult = { exitCode: 0, output: "" };
  // 设成 false 就当作没装 codex。
  hasCodex = true;
  // 执行命令时顺带做的事（如重启后 Codex 改写进程记录文件）。
  onRun: ((command: HostCommand) => void) | null = null;
  // 系统设置里的代理；缺省没设。
  systemProxy: SystemProxy = NO_SYSTEM_PROXY;
  // 设了就让 readSystemProxy 抛它（问不到系统）。
  systemProxyError: HostProcessesError | null = null;

  async list(): Promise<HostProcess[]> {
    this.lists += 1;
    if (this.listError !== null) throw this.listError;
    return this.processes;
  }

  async readCodexHome(pid: number): Promise<string | null> {
    return this.codexHomes.get(pid) ?? null;
  }

  async findCodex(input: { env: Record<string, string> }): Promise<HostProgram | null> {
    if (!this.hasCodex) return null;
    return { command: FAKE_CODEX_PATH, args: [], env: input.env };
  }

  async run(command: HostCommand): Promise<HostCommandResult> {
    this.runs.push(command);
    this.onRun?.(command);
    return this.runResult;
  }

  async readSystemProxy(): Promise<SystemProxy> {
    if (this.systemProxyError !== null) throw this.systemProxyError;
    return this.systemProxy;
  }
}
