export class CustomError extends Error {
  public msg: string;

  constructor(msg: string) {
    super(msg);
    this.msg = msg;
  }
}
