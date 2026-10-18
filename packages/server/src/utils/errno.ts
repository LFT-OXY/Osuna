/** Node 的系统调用错误（带 code，如 ENOENT、EACCES）。 */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
