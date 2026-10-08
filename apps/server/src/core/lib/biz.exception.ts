import { HTTPException } from 'hono/http-exception'

export class BizException extends HTTPException {
  public readonly code: number

  constructor({ code, message }: { code: number; message: string }, customMessage?: string) {
    super(200, { message: customMessage || message })
    this.code = code
  }
}
